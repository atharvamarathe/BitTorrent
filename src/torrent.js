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
  constructor(torrentFile, options = {}) {
    this.metadata = parse_torrent(torrentFile);
    this.clientId =
      options.clientId || "-AMVK01-" + Math.random().toString().slice(2, 14);
    this.metadata.peerId = this.clientId;
    this.port = options.port || 6882;
    this.downloadPath = options.downloadPath || "../downloads/";
    this.upSpeed = 0;
    this.downSpeed = 0;
    this.uploadLimit = options.uploadLimit;
    this.downloadLimit = options.downloadLimit;
    this.maxConnections = options.maxConnections || 30;
    this.peers = [];
    this.isComplete = false;
    this.files = [];
    this.uploaded = 0;
    this.downloaded = 0;
    this.pieces = [];
  }

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
        f.open();
        this.files.push(f);
        offset += file.length;
      }
      // this.files.forEach((f) => f.close());
    } else {
      const f = new File(dest, this.metadata.length, 0);
      f.open();
      this.files.push(f);
    }
  };

  start = () => {
    this.createFiles();
    this.createPieces();
    const tracker = new Tracker(this.metadata.announce, this);
    tracker.announce(Tracker.events.STARTED, (err, info) => {
      if (err) logger.error(err);
      this.startPeers(info);
    });
  };
}

module.exports = Torrent;
