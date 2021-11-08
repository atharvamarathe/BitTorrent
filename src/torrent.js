const parse_torrent = require("./torrent-file-parser");
const fs = require("fs");
const path = require("path");
const Peer = require("./peer");
const Piece = require("./piece");
const File = require("./file");
const Tracker = require("./tracker");

class Torrent {
  constructor(torrentFile, options = {}) {
    this.metadata = parse_torrent(torrentFile);
    this.clientId =
      options.clientId || "-AMVK01-" + Math.random().toString().slice(2, 14);
    this.metadata.peerId = this.clientId;
    this.port = options.port || 6882;
    this.downloadPath = options.downloadPath || ".";
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
    for (let i = 0; i < n; i++) {
      this.pieces.push(
        new Piece(i, pieceLength, pieces.slice(i * 20, i * 20 + 20))
      );
    }
    if (length % pieceLength !== 0) {
      this.pieces[n - 1].length = length % pieceLength;
    }
  };

  startPeers = (info) => {
    for (let i = 0; i < info.peerList.length; i++) {
      const p = new Peer(info.peerList[i].ip, info.peerList[i].port, this);
      this.peers.push(p);
      p.start();
    }
  };

  createFiles = () => {
    const dest = this.downloadPath + this.metadata.fileName;

    if (this.metadata.files) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest);
      }
      let offset = 0;
      for (const file of this.metadata.files) {
        filedir = path.join(dest, ...file.path(0, file.path.length - 1));
        filepath = path.join(filedir, file.path[file.path.length - 1]);
        fs.mkdirSync(filedir, { rescursive: true });
        this.files.push(new File(filepath, file.length, offset));
        offset += file.length;
      }
    } else {
      this.files.push(new File(dest, this.metadata.length, 0));
    }
  };

  start = async () => {
    // this.createFiles();
    const tracker = new Tracker(this.metadata.announce, this);
    const info = await tracker.announce();
    console.log(info);
    this.createPieces();
    this.startPeers(info);
  };
}

module.exports = Torrent;
