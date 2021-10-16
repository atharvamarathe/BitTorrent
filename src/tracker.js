const dgram = require("dgram");
const axios = require("axios").default;
const bencode = require("bencode");
const crypto = require("crypto");
const parse_torrent = require("./torrent-file-parser");

function createHTTPTrackerURL(metaData) {
  let query = {
    info_hash: escape(metaData["infoHash"].toString("binary")),
    peer_id: metaData["peerId"],
    port: 6882,
    uploaded: 0,
    downloaded: 0,
    left: metaData["length"],
    compact: 1,
  };
  let url = metaData["announce"] + "?";
  for (const key in query) {
    url += key + "=" + query[key] + "&";
  }
  return url;
}

function announceHTTP(metaData) {
  const url = createHTTPTrackerURL(metaData);
  axios
    .get(url, { responseType: "arraybuffer", transformResponse: [] })
    .then((res) => {
      const data = res.data;
      info = bencode.decode(data);
      // info.peers = info.peers.toString("utf-8");
      console.log(info);
    })
    .catch((e) => console.log(e));
}

function getUDPAnnoucePayload(metaData, connectionId) {
  const payload = Buffer.alloc(98);
  connectionId.copy(payload, 0); // Connection ID
  payload.writeUInt32BE(1, 8); // Action ID
  crypto.randomBytes(4).copy(payload, 12);
  metaData["infoHash"].copy(payload, 16);
  Buffer.from(metaData["peerId"]).copy(payload, 36); // Peer ID
  payload.write(metaData["peerId"], 36);
  // Downloaded
  payload.fill(0, 56, 64);

  left = Buffer.alloc(8);
  left.writeUInt32BE(metaData["length"], 0);
  left.copy(payload, 64);
  // uploaded
  payload.fill(0, 72, 80);
  Buffer.alloc(8).copy(payload, 72);
  //event = 0 (0: none; 1: completed; 2: started; 3: stopped)
  payload.writeUInt32BE(0, 80);
  // ip
  payload.writeUInt32BE(0, 84);
  //random key
  crypto.randomBytes(4).copy(payload, 88);
  // number of peers wanted (default = -1)
  payload.writeInt32BE(-1, 92);
  // port
  payload.writeUInt16BE(6884, 96);
  console.log(payload);
  return payload;
}

function announceUDP(url, metaData) {
  const udpSocket = dgram.createSocket("udp4");
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(0x417, 0);
  payload.writeUInt32BE(0x27101980, 4);
  payload.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(payload, 12);

  console.log(url.hostname, url.port);

  udpSocket.send(payload, url.port, url.hostname);
  udpSocket.on("error", (err) => {
    console.log(err);
  });
  udpSocket.on("message", (msg) => {
    console.log("Message is ", msg);
    // udpSocket.close();
    annoucePayload = getUDPAnnoucePayload(metaData, getConnectionID(msg));
    udpSocket.send(annoucePayload, url.port, url.hostname, () => {});
    udpSocket.on("error", (err) => {
      console.log(err);
    });
    udpSocket.on("message", (msg1) => {
      console.log("Response : ", msg1);
      udpSocket.close();
    });
  });
}

let filename;
// filename = "./demoTorrentFiles/ubuntu-20.04.3-live-server-amd64.iso.torrent";
// filename = "./demoTorrentFiles/big-buck-bunny.torrent";

const metaData = parse_torrent(filename);
const url = new URL(metaData["announce"]);
if (url.protocol == "udp:") {
  announceUDP(url, metaData);
} else {
  announceHTTP(metaData);
}
