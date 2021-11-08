const Torrent = require("./torrent.js");
let filename;
filename = "./demoTorrentFiles/ubuntu-20.04.3-live-server-amd64.iso.torrent";

function main() {
  const torrent = new Torrent(filename);
  torrent.start();
}

main();
