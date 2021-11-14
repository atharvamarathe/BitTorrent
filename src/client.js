const Seeder = require("./seeder");
const Torrent = require("./torrent");
var logger = require("log4js").getLogger("client.js");

class Client {
  constructor(options = {}) {
    this.clientId =
      options.clientId || "-AMVK01-" + Math.random().toString().slice(2, 14);
    this.port = options.port || 6882;
    this.torrents = {};
    this.seeder = new Seeder(this.port, this);
  }

  addTorrent = (filename, options) => {
    const t = new Torrent(filename, this.clientId, this.port, options);
    if (!this.torrents[t.metadata.infoHash]) {
      this.torrents[t.metadata.infoHash] = t;
    }
    return t;
  };

  removeTorrent = (torrent) => {
    delete this.torrents[torrent.metadata.infoHash];
  };
}

module.exports = Client;
