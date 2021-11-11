const { Socket } = require("dgram");
const net = require("net");
const Peer = require("./peer");
var logger = require("log4js").getLogger("seeder.js");

class Seeder {
  constructor(port, client) {
    this.port = port;
    this.client = client;
    this.server = net.createServer((sock) => this.handleConnection(sock));
    this.server.on("listening", () => {
      logger.debug("Server is listening");
    });
    this.server.on("error", (err) => {
      logger.error(err);
    });
    this.server.listen(this.port);
  }

  handleConnection = (sock) => {
    const { address, port } = sock.address();
    const peer = new Peer(address, port, null, sock, (infoHash) => {
      const torrent = this.client.torrents[infoHash];
      if (!torrent) {
        peer.disconnect("peer requesting unknown torrent. disconnecting");
      } else {
        peer.handleLeecher(torrent);
      }
    });
    peer.start();
  };
}

module.exports = Seeder;
