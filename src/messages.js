const parse_torrent = require("./torrent-file-parser");
// const net = require("net");
// let filename;
// filename = "./demoTorrentFiles/ubuntu-20.04.3-live-server-amd64.iso.torrent";
// filename = "./demoTorrentFiles/big-buck-bunny.torrent";

const buildHandshakePacket = (metaData) => {
  const pstr = "BitTorrent protocol";
  const payload = Buffer.alloc(68);
  const infoHash = metaData["infoHash"];
  const peerId = metaData["peerId"];
  payload.writeUInt8(19, 0); //pstrlen
  payload.write(pstr, 1); //pstr
  payload.writeUInt32BE(0, 20); //reserved bytes
  payload.writeUInt32BE(0, 24); //reserved bytes
  infoHash.copy(payload, 28); //infoHash
  Buffer.from(peerId).copy(payload, 48); // PeerID
  return payload;
};

const getKeepAliveMsg = () => {
  const msg = Buffer.alloc(4);
  return msg;
};

const getChokeMsg = () => {
  const msg = Buffer.alloc(5);
  msg.writeUInt32BE(1, 0); //len
  msg.writeUInt8(0, 4); //ID
  return msg;
};

const getUnChokeMsg = () => {
  const msg = Buffer.alloc(5);
  msg.writeUInt32BE(1, 0); //len
  msg.writeUInt8(1, 4); //ID
  return msg;
};

const getInterestedMsg = () => {
  const msg = Buffer.alloc(5);
  msg.writeUInt32BE(1, 0); //len
  msg.writeUInt8(2, 4); //ID
  return msg;
};

const getNotInterestedMsg = () => {
  const msg = Buffer.alloc(5);
  msg.writeUInt32BE(1, 0); //len
  msg.writeUInt8(3, 4); //ID
  return msg;
};

const getHaveMsg = (pieceIndex) => {
  const msg = Buffer.alloc(9);
  msg.writeUInt32BE(5, 0); //len
  msg.writeUInt8(4, 4); //ID
  msg.writeUInt32BE(pieceIndex, 5);
  return msg;
};

const getBitFieldMsg = (payload) => {
  const msg = Buffer.alloc(5 + payload.length);
  msg.writeUInt32BE(1 + payload.length, 0); // length
  msg.writeUInt8(5, 4); // ID
  payload.copy(msg, 5);
  return msg;
};

const getRequestMsg = (payload) => {
  const msg = Buffer.alloc(17);
  msg.writeUInt32BE(13, 0); //len
  msg.writeUInt8(6, 4); // ID
  msg.writeUInt32BE(payload.index, 5); // index
  msg.writeUInt32BE(payload.begin, 9); //begin
  msg.writeUInt32BE(payload.length, 13); //legnth

  return msg;
};

const sendPiece = (payload) => {
  const msg = Buffer.alloc(13 + payload.block.length);
  msg.writeUInt32BE(9 + payload.block.length, 0); //len
  msg.writeUInt8(7, 4); //ID
  msg.writeUInt32BE(payload.index, 5); //index
  msg.writeUInt32BE(payload.begin, 9); //begin
  payload.block.copy(msg, 13); //block
  return payload;
};

const getCancelMsg = () => {
  const msg = Buffer.alloc(17);
  msg.writeUInt32BE(13, 0);
  msg.writeUInt8(8, 4);
  msg.writeUInt32BE(payload.index, 5);
  msg.writeUInt32BE(payload.begin, 9);
  msg.writeUInt32BE(payload.length, 13);
  return msg;
};

const parseMessage = (msg) => {
  const ID = msg.length > 4 ? msg.readInt8(4) : null;
  let payload = msg.length > 5 ? msg.slice(5) : null;
  if (ID == 6 || ID == 7 || ID == 8) {
    const data = payload.slice(8);
    payload = {
      index: payload.readInt32BE(0),
      begin: payload.readInt32BE(4),
    };
    payload[ID == 7 ? "block" : "length"] = data;
  }
  return {
    size: msg.readInt32BE(0),
    id: ID,
    payload: payload,
  };
};

module.exports = {
  buildHandshakePacket,
  getBitFieldMsg,
  getCancelMsg,
  getChokeMsg,
  getHaveMsg,
  getInterestedMsg,
  getKeepAliveMsg,
  getNotInterestedMsg,
  getRequestMsg,
  getUnChokeMsg,
  parseMessage,
};
// const server = net.createServer();

// const metaData = parse_torrent(filename);
// const handshakePayload = buildHandshakePacket(metaData);
// console.log(handshakePayload);
