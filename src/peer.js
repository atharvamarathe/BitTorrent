const { Socket, createConnection } = require("net");
const net = require("net");
const messages = require("./messages");
const msgId = messages.msgId;
const BitVector = require("./util/bitvector");
const Piece = require("./piece");
var log4js = require("log4js");
const util = require("util");

log4js.configure({
  appenders: {
    peer: {
      type: "file",
      filename: `./logs/peer-${new Date().toISOString()}.log`,

      layout: {
        type: "pattern",
        pattern: "%d %l %f{1} %m",
      },
    },
  },
  categories: {
    default: { appenders: ["peer"], level: "error", enableCallStack: true },
  },
});
var logger = log4js.getLogger("peer.js");
logger.level = "info";

class Peer {
  constructor(peerIp, peerPort, torrent, socket, hscb) {
    this.ip = peerIp;
    this.port = peerPort;
    this.buffer = Buffer.alloc(0);
    this.socket = socket;
    this.state = {
      peerChoking: true,
      peerInterested: false,
      amChoking: true,
      amInterested: false,
    };
    this.torrent = torrent;
    this.bitField = torrent ? new BitVector(this.torrent.pieces.length) : null;
    this.handshakeDone = false;
    this.msgProcessing = false;
    this.upstats = {
      numbytes: 0,
      rate: 0,
      history: [],
    };
    this.downstats = {
      numbytes: 0,
      rate: 0,
      history: [],
    };
    this.uploadQueue = [];
    this.uniqueId = this.ip + ":" + this.port;
    this.intervalId = null;
    this.lastReceivedTime = new Date().getTime();
    this.hscb = hscb;
    this.currPieceIndex = -1;
  }

  start = () => {
    // if peer was now initialised with a socket, first create the connection
    if (!this.socket) {
      logger.debug("Connecting to peer : ", this.ip, this.port);

      this.socket = net.createConnection({
        host: this.ip,
        port: this.port,
      });

      // do handshake after connecting
      this.socket.on("connect", () => {
        let hs = messages.buildHandshakePacket(
          this.torrent.metadata.infoHash,
          this.torrent.clientId
        );
        this.socket.write(hs);
      });
    }
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("end", () => this.onEnd());
    // send keepalive every 2 minutes
    this.intervalId = setInterval(() => {
      this.send(messages.getKeepAliveMsg());
      if (new Date().getTime() - this.lastReceivedTime >= 100000) {
        if (
          this.currPieceIndex != -1 &&
          this.torrent.pieces[this.currPieceIndex].state === Piece.states.ACTIVE
        ) {
          this.torrent.pieces[this.currPieceIndex].state =
            Piece.states.INCOMPLETE;
        }
        this.disconnect("disconnecting the peer due to inactivity");
      }
    }, 60000);
  };

  send = (msg) => {
    if (this.socket) {
      this.socket.write(msg);
    }
  };

  handleLeecher = (torrent) => {
    this.torrent = torrent;
    this.bitField = new BitVector(this.torrent.pieces.length);
    torrent.peers.push(this);

    // respond to handshake and send bitfield
    let hs = messages.buildHandshakePacket(
      this.torrent.metadata.infoHash,
      this.torrent.clientId
    );
    this.socket.write(hs);
    const bf = new BitVector(this.torrent.pieces.length);
    for (let p of this.torrent.pieces) {
      if (p.state == Piece.states.COMPLETE) bf.set(p.index);
    }
    let bitfield = messages.getBitFieldMsg(bf.buf);
    this.socket.write(bitfield);
  };

  handleUploadQueue = () => {
    if (this.uploadQueue.length > 0) {
      const { index, begin, length } = this.uploadQueue.shift();
      if (this.torrent.pieces[index].state === Piece.states.COMPLETE) {
        this.torrent.pieces[index].getData(begin, length).then((data) => {
          this.socket.write(data);
          this.torrent.uploaded += length;
          this.upstats.numbytes += length;
          this.updateUploadRate();
          handleUploadQueue();
        });
      }
    } else this.uploading = false;
  };

  isMsgComplete = () => {
    if (this.buffer.length < 4) return false;
    const expectedlen = this.handshakeDone
      ? this.buffer.readUInt32BE(0) + 4
      : this.buffer.readUInt8(0) + 49; // length of pstr + 49
    return this.buffer.length >= expectedlen;
  };

  handleBitfield = (m) => {
    this.bitField = BitVector.fromBuffer(
      m.payload.slice(0, Math.ceil(this.torrent.pieces.length / 8))
    );

    for (let i = 0; i < this.torrent.pieces.length; i++) {
      this.torrent.pieces[i].count += this.bitField.get(i);
    }

    if (this.state.amInterested == false) {
      this.state.amInterested = true;
      const interested = messages.getInterestedMsg();
      logger.debug(this.uniqueId, " : Sending Interested message : ");
      this.socket.write(interested);
    }
  };

  requestPiece = () => {
    let pieceIndex = -1;
    if (this.torrent.mode === "endgame") {
      let missing = [];
      for (const m in this.torrent.missingPieces) {
        const ind = parseInt(m, 10);
        if (this.bitField.test(ind)) missing.push(ind);
      }
      if (missing.length > 0) {
        const r = Math.floor(Math.random() * missing.length);
        pieceIndex = missing[r];
      }
    } else {
      pieceIndex = this.getRarestPieceIndex();
    }
    if (pieceIndex != -1) {
      const p = this.torrent.pieces[pieceIndex];
      p.state = Piece.states.ACTIVE;
      for (let i = 0; i < p.numBlocks; i++) {
        if (this.torrent.state === "endgame" && p.completedBlocks.test(i)) {
          continue;
        }
        let len = Piece.BlockLength;
        //if last piece, modify length
        if (i === p.numBlocks - 1 && p.length % Piece.BlockLength !== 0) {
          len = p.length % Piece.BlockLength;
        }
        const requestPacket = {
          index: pieceIndex,
          begin: Piece.BlockLength * i,
          length: len,
        };
        this.send(messages.getRequestMsg(requestPacket));
      }
      this.currPieceIndex = pieceIndex;
    } else {
      this.send(messages.getNotInterestedMsg(), () =>
        this.disconnect("peer has no pieces useful to us")
      );
    }
  };

  getRarestPieceIndex = () => {
    let rarity = 100000; // large number
    let pieceIndex = -1;
    let ps = this.torrent.pieces;
    for (let i = 0; i < ps.length; i++) {
      if (
        this.bitField.test(i) &&
        ps[i].count < rarity &&
        ps[i].state === Piece.states.PENDING
        // ps[i].state !== Piece.states.COMPLETE
      ) {
        rarity = ps[i].count;
        pieceIndex = i;
      }
    }
    return pieceIndex;
  };

  handleMsg = () => {
    const msg = messages.parseMessage(this.buffer);
    this.buffer = this.buffer.slice(4 + this.buffer.readUInt32BE(0));

    switch (msg.id) {
      case msgId.CHOKE:
        this.state.peerChoking = true;
        logger.debug(this.uniqueId, " : Choked us");
        // Should we end the socket
        const interested = messages.getInterestedMsg();
        this.socket.write(interested);
        break;

      case msgId.UNCHOKE:
        this.state.peerChoking = false;
        logger.debug(`Peer - ${this.uniqueId} unchoked us`);
        this.updateDownloadRate();
        this.requestPiece();
        break;

      case msgId.INTERESTED:
        logger.debug(`Peer - ${this.uniqueId} is interested`);
        this.state.peerInterested = true;
        this.socket.write(messages.getUnChokeMsg);
        break;

      case msgId.UNINTERESTED:
        this.state.peerInterested = false;
        logger.debug(`Peer - ${this.uniqueId} is not interested`);
        break;
      //close the socket

      case msgId.HAVE:
        const pieceIndex = msg.payload.readUInt32BE(0);
        this.bitField.set(pieceIndex);
        this.torrent.pieces[pieceIndex].count += 1;
        break;

      case msgId.BITFIELD:
        this.handleBitfield(msg);
        break;

      case msgId.REQUEST:
        this.uploadQueue.push(msg.payload);
        if (!this.uploading) {
          this.uploading = true;
          this.handleUploadQueue();
        }
        break;

      case msgId.PIECE:
        const { index, begin, block } = msg.payload;
        const piece = this.torrent.pieces[index];
        if (piece.state !== Piece.states.COMPLETE) {
          const pieceComplete = piece.saveBlock(begin, block);
          if (pieceComplete) {
            this.downstats.numbytes += piece.length;
            this.torrent.downloaded += piece.length;
            this.updateDownloadRate();
            if (this.torrent.mode === "endgame") {
              delete this.torrent.missingPieces[index];
            }
            for (const p of this.torrent.peers) {
              if (!p.bitField.test(index)) {
                p.send(messages.getHaveMsg(index));
              }
            }
            this.requestPiece();
            this.torrent.updateState();
          }
        }
        break;

      case msgId.CANCEL:
        //cancel the seeding of the piece
        const { i, b, l } = msg.payload;
        this.uploadQueue = this.uploadQueue.filter(
          (p) => !(p.index === i && p.begin === b && p.length === l)
        );
        break;

      case msgId.PORT:
        break;

      case msgId.KEEPALIVE:
        //keep alive in socket
        break;

      default:
        break;
    }
  };

  updateDownloadRate = () => {
    // length in bytes, t in s, rate in bps
    const history = this.downstats.history;
    history.push({
      time: new Date().getTime(),
      numbytes: this.downstats.numbytes,
    });
    const currtime = new Date().getTime();
    const t = (currtime - history[0].time) / 1000; //time in sec
    if (t === 0) return;
    const n = this.downstats.numbytes - history[0].numbytes;
    this.downstats.rate = n / t;
    while (currtime - history[0].time > 1000) {
      history.shift();
    }
  };

  updateUploadRate = () => {
    const history = this.upstats.history;
    history.push({
      time: new Date().getTime(),
      numbytes: this.upstats.numbytes,
    });
    const currtime = new Date().getTime();
    const t = (currtime - history[0].time) / 1000; //time in sec
    if (t === 0) return;
    const n = this.upstats.numbytes - history[0].numbytes;
    this.upstats.rate = n / t;
    while (currtime - history[0].time > 1000) {
      history.shift();
    }
  };

  handleHandshake = () => {
    const hs = messages.parseHandshake(this.buffer);
    if (hs.pstr == "BitTorrent protocol") {
      this.handshakeDone = true;
      logger.debug(`Handshake done for Peer  ${this.uniqueId}`);
    }
    if (this.hscb) {
      this.hscb(hs.infoHash);
    }
    this.buffer = this.buffer.slice(this.buffer.readUInt8(0) + 49);
  };

  onData = (data) => {
    this.lastReceivedTime = new Date().getTime();
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.msgProcessing) return;
    this.msgProcessing = true;
    while (this.isMsgComplete()) {
      if (this.handshakeDone) {
        this.handleMsg();
      } else {
        this.handleHandshake();
      }
    }
    this.msgProcessing = false;
  };
  onError = (err) => {
    this.disconnect(err.message);
  };

  disconnect = (msg, reconnectionTimeOut) => {
    logger.info(`peer disconnected ${this.uniqueId} with message ${msg}`);
    this.disconnected = true;

    for (let i = 0; i < this.torrent.pieces.length; i++) {
      this.torrent.pieces[i].count -= this.bitField.get(i);
    }
    this.torrent.peers = this.torrent.peers.filter(
      (p) => p.uniqueId !== this.uniqueId
    );
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  };

  onEnd = () => {
    logger.debug(`Peer ${this.uniqueId} received end`);
    this.stream = null;
    if (this.state.amInterested) {
      this.disconnect("reconnect", 5000);
    } else {
      this.disconnect("Not interested");
    }
  };

  [util.inspect.custom](depth, opts) {
    return JSON.stringify({
      uid: this.uniqueId,
      state: this.state,
      currPiece: this.currPieceIndex,
    });
  }
}

module.exports = Peer;
