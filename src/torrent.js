const parse_torrent = require("./torrent-file-parser");
const fs = require("fs");
const path = require("path");
clientID = () => {
  let clientId = "-AMVK01-" + Math.random().toString().slice(2, 14);
  return clientId;
};
class Torrent {
  constructor(torrentFile, options) {
    this.metadata = parse_torrent(torrentFile);
    this.clientId = options.clientId || clientID();
    this.port = options.port || 6882;
    this.downloadPath = options.downloadPath || ".";
    this.pieces = metadata.pieces;
    this.pieceLength = metadata.pieceLength;
    this.upSpeed = 0;
    this.downSpeed = 0;
    this.uploadLimit = options.uploadLimit;
    this.downloadLimit = options.downloadLimit;
    this.maxConnections = options.maxConnections;
    this.maxConnections = options.maxConnections || 30;
    this.peers = {};
    this.isComplete = false;
    this.files = [];
  }

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
      self.files.push(new File(dest, this.metadata.length, 0));
    }
  };
}
