const fs = require("fs");
const { Socket, createConnection } = require("net");
const net = require("net");
const messages = require("./messages");
const msgId = messages.msgId;
const crypto = require("crypto");

var log4js = require("log4js");
var logger = log4js.getLogger();
logger.level = "debug";

class Peer {
  constructor(peerIp, peerPort, torrent, socket = null) {
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
    this.bitField = 0;
    this.piecesDownloaded = [];
    this.handshakeDone = false;
    this.msgProcessing = false;
    this.downloadRate = 0;
    this.uploadRate = 0;
    this.pieceBuffer = [];
    this.blockQueue = [];
    this.currBlock = -1;
    this.uniqueId = this.ip + ":" + this.port;
  }

  start = () => {
    // if peer was now initialised with a socket, first create the connection
    if (!this.socket) {
      logger.info("Connecting to peer : ", this.ip, this.port);

      this.socket = net.createConnection({
        host: this.ip,
        port: this.port,
      });

      // do handshake after connecting
      this.socket.on("connect", () => {
        let hs = messages.buildHandshakePacket(this.torrent.metadata);
        this.socket.write(hs);
      });
    }
    let self = this;
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("end", () => this.onEnd());
  };

  isMsgComplete = () => {
    if (this.buffer.length < 4) return false;
    const expectedlen = this.handshakeDone
      ? this.buffer.readUInt32BE(0) + 4
      : this.buffer.readUInt8(0) + 49; // length of pstr + 49
    return this.buffer.length >= expectedlen;
  };

  handleBitfield = (m) => {
    this.bitField = m.payload;
    if (this.state.amInterested == false) {
      const interested = messages.getInterestedMsg();
      logger.info(
        this.uniqueId,
        " : Sending Interested message : ",
        interested
      );
      this.socket.write(interested);
    }
  };

  requestBlock = () => {
    if (this.blockQueue.length > 0) {
      const requestPacket = this.blockQueue.shift();
      const requestMsg = messages.getRequestMsg(requestPacket);
      logger.info("Requesting block to ", this.uniqueId, " : ", requestMsg);
      this.socket.write(requestMsg);
    } else {
      logger.warn("Complete Piece Downloaded ");
      this.savePiece();
      this.pieceBuffer = [];
      // logger.warn(this.torrent.pieces);
    }
  };

  verifyPiece = (Piece) => {
    let shasum = crypto.createHash("sha1").update(Piece.data).digest();
    if (this.torrent.metadata.pieces[Piece.index] == shasum) {
      return true;
    } else {
      return false;
    }
  };

  savePiece = () => {
    let PieceData = Buffer.alloc(0);
    for (let i = 0; i < this.pieceBuffer.length; i++) {
      PieceData = Buffer.concat([PieceData, this.pieceBuffer[i].block]);
    }
    const Piece = {
      index: this.pieceBuffer[0].index,
      data: PieceData,
    };
    if (this.verifyPiece(Piece)) {
      logger.info("Piece with Index : ", Piece.index, " verified");
      this.piecesDownloaded.push(Piece.index);
    } else {
      logger.info("Piece with Index : ", Piece.index, " Checksum mismatch");
    }

    this.torrent.pieces[Piece.index] = Piece;
  };

  buildBlockRequestQueue = () => {
    let offset = 0;
    for (
      let i = 0;
      i < this.torrent.metadata.pieceLength / Math.pow(2, 14);
      i++
    ) {
      const requestPacket = {
        index: 3,
        begin: offset,
        length: Math.pow(2, 14),
      };
      offset += Math.pow(2, 14);
      this.blockQueue.push(requestPacket);
    }
    if (this.torrent.metadata.pieceLength % Math.pow(2, 14)) {
      const requestPacket = {
        index: idx,
        begin: offset,
        length: this.torrent.metadata.pieceLength % Math.pow(2, 14),
      };
      this.blockQueue.push(requestPacket);
    }
  };

  handleMsg = () => {
    const msg = messages.parseMessage(this.buffer);
    this.buffer = this.buffer.slice(4 + this.buffer.readUInt32BE(0));
    // logger.debug(this.uniqueId, " : ", "Received Message : ", msg);

    switch (msg.id) {
      case msgId.CHOKE:
        this.state.peerChoking = true;
        logger.debug(this.uniqueId, " : Choked us");
        // Should we end the socket
        break;

      case msgId.UNCHOKE:
        this.state.peerChoking = false;
        logger.debug(`Peer - ${this.uniqueId} unchoked us`);
        this.buildBlockRequestQueue();
        this.requestBlock();
        break;

      case msgId.INTERESTED:
        logger.debug(`Peer - ${this.uniqueId} is interested`);
        this.state.peerInterested = true;
        break;

      case msgId.UNINTERESTED:
        this.state.peerInterested = false;
        logger.debug(`Peer - ${this.uniqueId} is not interested`);
        break;
      //close the socket

      case msgId.HAVE:
        const pieceIndex = msg.payload.readUInt32BE(0);

        // update the bitfield
        break;
      case msgId.BITFIELD:
        this.handleBitfield(msg);
        break;

      case msgId.REQUEST:
        //seeding
        break;

      case msgId.PIECE:
        this.pieceBuffer.push(msg.payload);
        this.requestBlock();
        break;

      case msgId.CANCEL:
        //cancel the seeding of the piece
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

  handleHandshake = () => {
    if (this.buffer.toString("utf-8", 1, 20) == "BitTorrent protocol") {
      this.handshakeDone = true;
      logger.info(`Handshake done for Peer  ${this.uniqueId}`);
    }
    this.buffer = this.buffer.slice(this.buffer.readUInt8(0) + 49);
  };

  onData = (data) => {
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
}

module.exports = Peer;
