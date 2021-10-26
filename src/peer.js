const fs = require("fs");
const { Socket, createConnection } = require("net");
const net = require("net");
const messages = require("./messages");

var log4js = require("log4js");
var logger = log4js.getLogger();
logger.level = "debug";

class Peer {
  constructor(peerIp, peerPort, torrent, socket = null) {
    this.ip = peerIp;
    this.port = peerPort;
    this.data = Buffer.alloc(0);
    this.socket = socket;
    this.state = {
      peerChoking: true,
      peerInterested: false,
      amChoking: true,
      amInterested: false,
    };
    this.bitField = 0;
    this.handshakeDone = false;
    this.downloadRate = 0;
    this.uploadRate = 0;
    this.torrent = torrent;
    this.uniqueId = this.ip + ":" + this.port;
  }

  start = () => {
    // if peer was now initialised with a socket, first create the connection
    if (!this.socket) {
      logger.info("Connecting to peer : ", self.ip, self.port);

      this.socket = net.createConnection({
        host: this.ip,
        port: this.port,
      });

      // do handshake after connecting
      this.socket.on("connect", () => {
        let hs = messages.buildHandshakePacket(this.torrent.metaData);
        this.socket.write(hs);
      });
    }
    let self = this;
    this.socket.on("error", (err) => this.onError(err));
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("end", () => this.onEnd());
  };

  onData = (data) => {
    if (this.handshakeDone) {
      const m = messages.parseMessage(data);
      if (m.id == 5) {
        this.bitField = m.payload;
        if (this.state.amInterested == false) {
          const interested = messages.getInterestedMsg();
          this.socket.write(interested);
        }
      } else if (m.id == 1) {
        this.state.peerChoking = false;
        logger.info(`Peer - ${this.uniqueId} unchoked us`);
        const requestPacket = {
          index: 3,
          begin: 0,
          length: Math.pow(2, 14),
        };
        const requestMsg = messages.getRequestMsg(requestPacket);

        this.socket.write(requestMsg);
      } else if (m.id == 7) {
        this.data += data;
      }
    } else if (data.length > 4) {
      if (data.toString("utf-8", 1, 20) == "BitTorrent protocol") {
        this.handshakeDone = true;
        logger.info(`Handshake done for Peer  ${this.uniqueId}`);
      }
    }
  };

  onError = (err) => {
    this.disconnect(err.message);
  };

  disconnect = (msg, reconnectionTimeOut) => {
    logger.info(`peer disconnected ${this.peer.uniqueId} with message ${msg}`);
    this.disconnected = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    // manage keepAlive timer and peerList in torrrent here here
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
