const Client = require("./client.js");
const Torrent = require("./torrent.js");
let filename;
filename = "./demoTorrentFiles/ubuntu-20.04.3-live-server-amd64.iso.torrent";
filename = "./demoTorrentFiles/t1.torrent";

function main() {
  const client = new Client();
  const t = client.addTorrent(filename);
}

main();
