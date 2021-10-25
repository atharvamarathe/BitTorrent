const parse_torrent = require("./torrent-file-parser");
const announce = require("./tracker.js");
const net = require("net");
const messages = require("./messages");
const { copyFileSync } = require("fs");
// const { Socket } = require("dgram");

function unchokeHandler(socket) {}

async function main() {
  let filename;
  filename = "./demoTorrentFiles/ubuntu-20.04.3-live-server-amd64.iso.torrent";
  // filename =
  //   "./demoTorrentFiles/FreeCoursesOnline.Me-Code-With-Mosh-The-Complete-Node.js-Course.torrent";

  const metaData = parse_torrent(filename);
  const announcePacket = await announce(metaData);
  // const announcePacket = announce(metaData);
  const peerHandshakePacket = messages.buildHandshakePacket(metaData);
  console.log(announcePacket.peerList[1]);
  const socket = net.createConnection({
    host: announcePacket.peerList[3].ip,
    port: announcePacket.peerList[3].port,
  });
  let hsdone = false;
  let isInterested = false;
  let isReceiving = false;
  let buffer = "";
  socket.on("connect", () => {
    socket.write(peerHandshakePacket);
  });
  socket.on("error", (err) => console.log(err));
  socket.on("data", (data) => {
    console.log("Outer Data ", data);
    if (isReceiving == true) {
      buffer += data;
      console.log(buffer.length);
      if (buffer.length > 16384) socket.end();
    } else if (hsdone) {
      const m = messages.parseMessage(data);
      console.log("Decoded data : ", m);
      if (m.id == 5) {
        const bitfield = m.payload;
        console.log(bitfield);
        if (isInterested == false) {
          const interested = messages.getInterestedMsg();
          socket.write(interested);
        }
      } else if (m.id == 1) {
        isInterested = true;
        const packet = {
          index: 3,
          begin: 0,
          length: Math.pow(2, 14),
        };
        console.log(packet);
        const msg = messages.getRequestMsg(packet);
        console.log(msg);
        socket.write(msg);
      } else if (m.id == 7) {
        isReceiving = true;
        // let buffer = "";
        buffer += data;
        // socket.end();
        console.log("Buffer Length ", buffer.length);
      }
    } else {
      hsdone = true;
      console.log(data.toString("utf-8", 1, 20));
    }
    // socket.end();
  });
  console.log(buffer);
}

main();
