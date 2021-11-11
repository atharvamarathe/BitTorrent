const parse_torrent = require("./torrent-file-parser");
const fs = require("fs");
const path = require("path");
const Peer = require("./peer");
const Piece = require("./piece");
const File = require("./file");
const Tracker = require("./tracker");
var log4js = require("log4js");
var logger = log4js.getLogger();
// logger.level = "debug";
logger.level = "warn";

class Torrent {
  static modes = {
    DEFAULT: "default",
    ENDGAME: "endgame",
    COMPLETED: "completed",
  };
  constructor(torrentFile, clientId, port, options = {}) {
    this.metadata = parse_torrent(torrentFile);
    this.clientId = clientId;
    this.port = port;
    this.downloadPath = options.downloadPath || "../downloads/";
    this.upSpeed = 0;
    this.downSpeed = 0;
    this.uploadLimit = options.uploadLimit;
    this.downloadLimit = options.downloadLimit;
    this.maxConnections = options.maxConnections || 30;
    this.peers = [];
    this.mode = Torrent.modes.DEFAULT;
    this.files = [];
    this.uploaded = 0;
    this.downloaded = 0;
    this.pieces = [];
    // available only in EndGame mode
    this.missingPieces = {};
  }

  isComplete = () => {
    let numDone = 0;
    let numActive = 0;
    for (const p of this.pieces) {
      if (p.state === Piece.states.COMPLETE) numDone++;
      else if (p.state === Piece.states.ACTIVE) numActive++;
    }
    if (numDone === this.pieces.length) {
      console.log("completed downloading torrent");
      this.shutdown();
    }
    // start ENDGAME mode if we have requested all pieces except one
    if (
      numDone + numActive >= this.pieces.length - 1 &&
      this.mode !== Torrent.modes.ENDGAME
    ) {
      console.warn("endgame started");
      this.mode = Torrent.modes.ENDGAME;
      const missing = this.pieces.filter(
        (p) => p.state !== Piece.states.COMPLETE
      );
      for (let m of missing) {
        this.missingPieces[m.index] = m;
      }
    }
    console.log("progress: ", numDone, "/", this.pieces.length);
  };

  shutdown = () => {
    this.files.forEach((f) => f.close());
    this.peers.forEach((p) => p.disconnect());
    process.exit(0);
  };

  createPieces = () => {
    const { pieces, pieceLength, length } = this.metadata;
    const n = pieces.length / 20;
    let f = 0;

    for (let i = 0; i < n; i++) {
      const included = [];
      const pend = i * pieceLength + pieceLength;

      while (f < this.files.length) {
        included.push(this.files[f]);
        const fend = this.files[f].offset + this.files[f].length;
        if (pend < fend) break;
        else if (pend > fend) f++;
        else {
          f++;
          break;
        }
      }
      this.pieces.push(
        new Piece(i, pieceLength, pieces.slice(i * 20, i * 20 + 20), included)
      );
    }
    if (length % pieceLength !== 0) {
      this.pieces[n - 1].length = length % pieceLength;
      this.pieces[n - 1].data = Buffer.alloc(this.pieces[n - 1].length);
    }
  };

  startPeers = (info) => {
    const peerMap = new Set(this.peers.map((p) => p.uniqueId));
    info.peerList.forEach((p) => {
      if (!peerMap.has(p.ip + ":" + p.port)) {
        const peer = new Peer(p.ip, p.port, this);
        this.peers.push(peer);
        peer.start();
      }
    });
    console.info("number of peers", this.peers.length);
  };

  createFiles = () => {
    const dest = this.downloadPath + this.metadata.fileName;
    if (this.metadata.files) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { rescursive: true });
      }
      let offset = 0;
      for (const file of this.metadata.files) {
        const filedir = path.join(
          dest,
          ...file.path.slice(0, file.path.length - 1)
        );
        const filepath = path.join(filedir, file.path[file.path.length - 1]);
        if (!fs.existsSync(filedir)) {
          fs.mkdirSync(filedir, { rescursive: true });
        }
        const f = new File(filepath, file.length, offset);
        f.open((err) => logger.error(err));
        this.files.push(f);
        offset += file.length;
      }
    } else {
      if (!fs.existsSync(this.downloadPath)) {
        fs.mkdirSync(this.downloadPath, { rescursive: true });
      }
      const f = new File(dest, this.metadata.length, 0);
      f.open((err) => logger.error(err));
      this.files.push(f);
    }
  };

  start = () => {
    this.createFiles();
    this.createPieces();
    let tracker;
    if (this.metadata.announce) {
      tracker = new Tracker(this.metadata.announce, this);
    } else {
      console.log(this.metadata.announceList[0]);
      tracker = new Tracker(this.metadata.announceList[0], this);
      // console.log(tracker);
    }
    tracker.announce(Tracker.events.STARTED, (err, info) => {
      if (err) logger.error(err);
      this.startPeers(info);
    });
  };
}

module.exports = Torrent;
