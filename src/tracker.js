const dgram = require("dgram");
const axios = require("axios").default;
const bencode = require("bencode");
const crypto = require("crypto");

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

function getConnectionID(response) {
  return response.slice(8);
}

function getPeersListCompact(resp) {
  let peersList = [];
  for (let i = 0; i < resp.length; i += 6) {
    peersList.push({
      ip: resp.slice(i, i + 4).join("."),
      port: resp.readUInt16BE(i + 4),
    });
  }
  return peersList;
}

function parseHTTPAnnounceResp(resp) {
  const responseInfo = bencode.decode(resp);
  return {
    protocol: "http",
    interval: responseInfo.interval,
    leechers: responseInfo.incomplete,
    seeders: responseInfo.complete,
    peerList: getPeersListCompact(responseInfo.peers),
  };
}

function announceHTTP(metaData) {
  return new Promise((resolve, reject) => {
    const url = createHTTPTrackerURL(metaData);
    axios
      .get(url, { responseType: "arraybuffer", transformResponse: [] })
      .then((res) => {
        const info = parseHTTPAnnounceResp(res.data);
        resolve(info);
      })
      .catch((e) => {
        console.log(e);
        reject(e);
      });
  });
}
function parseUDPAnnounceResp(resp) {
  return {
    protocol: "udp",
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    leechers: resp.readUInt32BE(8),
    seeders: resp.readUInt32BE(12),
    peerList: getPeersListCompact(resp.slice(20)),
  };
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
  return payload;
}

const getUDPConnectPayload = () => {
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(0x417, 0);
  payload.writeUInt32BE(0x27101980, 4);
  payload.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(payload, 12);
  return payload;
};

function announceUDP(url, metaData) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const payload = getUDPConnectPayload();
    socket.send(payload, url.port, url.hostname);
    socket.on("error", (err) => {
      console.log(err);
      reject(err);
    });
    socket.on("message", (msg) => {
      annoucePayload = getUDPAnnoucePayload(metaData, getConnectionID(msg));
      socket.send(annoucePayload, url.port, url.hostname, () => {});
      socket.on("error", (err) => {
        console.log(err);
        reject(err);
      });
      socket.on("message", (msg1) => {
        socket.close();
        const resp = parseUDPAnnounceResp(msg1);
        resolve(resp);
      });
    });
  });
}

const announce = (metaData) => {
  const url = new URL(metaData["announce"]);
  if (url.protocol == "udp:") {
    return announceUDP(url, metaData);
  } else {
    return announceHTTP(metaData);
  }
};

module.exports = announce;
