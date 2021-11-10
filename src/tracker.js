const dgram = require("dgram");
const axios = require("axios").default;
const bencode = require("bencode");
const crypto = require("crypto");
const logger = require("log4js").getLogger();

const CONNECTING = "connecting";
const ERROR = "error";
const STOPPED = "stopped";
const WAITING = "waiting";

class Tracker {
  static events = {
    STARTED: "started",
    COMPLETED: "completed",
    STOPPED: "stopped",
  };
  constructor(url, torrent) {
    this.url = new URL(url);
    this.torrent = torrent;
    this.state = STOPPED;
    this.intervalId = null;
    if (this.url.protocol == "udp:") {
      this.handler = new UdpHandler(this);
    } else {
      this.handler = new HttpHandler(this);
    }
  }

  announce(event, cb) {
    console.log("announcing");
    this.state = CONNECTING;
    this.handler
      .connect(event)
      .then((data) => {
        this.state = WAITING;
        if (event === Tracker.events.STARTED) {
          if (this.intervalId) {
            clearInterval(this.intervalId);
          }
          if (data.interval) {
            this.intervalId = setInterval(() => {
              this.announce(event, cb);
            }, data.interval * 1000);
          }
        } else if (event === Tracker.events.STOPPED) {
          clearInterval(this.intervalId);
          this.intervalId = null;
          this.state = STOPPED;
        }
        cb(null, data);
      })
      .catch((err) => {
        this.state = ERROR;
        if (event === Tracker.events.STARTED) {
          setTimeout(() => this.announce(event, cb), 10000);
        }
        cb(err);
      });
  }
}

class HttpHandler {
  constructor(tracker) {
    this.tracker = tracker;
  }

  connect = (event) => {
    return new Promise((resolve, reject) => {
      const url = this.createURL(event);
      axios
        .get(url, { responseType: "arraybuffer", transformResponse: [] })
        .then((res) => {
          const info = this.parseResp(res.data);
          resolve(info);
        })
        .catch((e) => {
          logger.error(e);
          reject(e);
        });
    });
  };

  createURL = (event) => {
    const { metadata, downloaded, clientId, uploaded, port } =
      this.tracker.torrent;
    let query = {
      info_hash: escape(metadata["infoHash"].toString("binary")),
      peer_id: clientId,
      port: port,
      uploaded: uploaded,
      downloaded: downloaded,
      left: metadata["length"] - downloaded,
      compact: 1,
    };
    if (event) query.event = event;
    let url = this.tracker.url.href + "?";
    for (const key in query) {
      url += key + "=" + query[key] + "&";
    }
    return url;
  };

  parseResp = (resp) => {
    const responseInfo = bencode.decode(resp);
    return {
      protocol: "http",
      interval: responseInfo.interval,
      leechers: responseInfo.incomplete,
      seeders: responseInfo.complete,
      peerList: getPeersList(responseInfo.peers),
    };
  };
}

const udpActions = {
  CONNECT: 0,
  ANNOUNCE: 1,
  SCRAPE: 2,
  ERROR: 3,
};

class UdpHandler {
  constructor(tracker) {
    this.transactionId = crypto.randomBytes(4);
    this.connectionId = null;
    this.tracker = tracker;
  }

  connect = (event) => {
    return new Promise((resolve, reject) => {
      const { port, hostname } = this.tracker.url;
      const socket = dgram.createSocket("udp4");
      socket.on("error", (err) => {
        logger.error(err);
        return reject(err);
      });
      const payload = this.getConnectPayload();
      socket.send(payload, port, hostname);
      socket.on("message", (msg) => {
        if (msg.length < 16) return reject();
        let action = msg.readUInt32BE(0);
        let respTransId = msg.slice(4, 8);
        if (this.transactionId.compare(respTransId)) return reject();
        switch (action) {
          case udpActions.CONNECT:
            this.connectionId = msg.slice(8);
            const annoucePayload = this.getAnnoucePayload(event);
            socket.send(annoucePayload, port, hostname);
            break;

          case udpActions.ANNOUNCE:
            socket.close();
            if (msg.length < 20) reject();
            const info = this.parseResp(msg);
            resolve(info);
            break;

          case udpActions.ERROR:
            err = msg.slice(8).toString();
            logger.error(err);
            reject(err);
            break;

          default:
            logger.warn("received unknown actionId from tracker");
        }
      });
    });
  };

  getAnnoucePayload = (event) => {
    const { metadata, clientId, downloaded, uploaded, port } =
      this.tracker.torrent;
    const payload = Buffer.alloc(98);
    this.connectionId.copy(payload, 0); // Connection ID
    payload.writeUInt32BE(udpActions.ANNOUNCE, 8); // Action ID (1 for announce)
    this.transactionId.copy(payload, 12);
    metadata["infoHash"].copy(payload, 16);
    Buffer.from(clientId).copy(payload, 36); // Peer ID

    // Downloaded, uploaded, left
    const left = getBufferUInt64BE(metadata["length"] - downloaded);
    const down = getBufferUInt64BE(downloaded);
    const up = getBufferUInt64BE(uploaded);
    down.copy(payload, 56);
    left.copy(payload, 64);
    up.copy(payload, 72);

    //event (0: none; 1: completed; 2: started; 3: stopped)
    let e = 0;
    if (event === Tracker.events.COMPLETED) e = 1;
    else if (event === Tracker.events.STARTED) e = 2;
    else if (event === Tracker.events.STOPPED) e = 3;
    payload.writeUInt32BE(e, 80);

    // ip
    payload.writeUInt32BE(0, 84);
    //random key
    crypto.randomBytes(4).copy(payload, 88);
    // number of peers wanted (default = -1)
    payload.writeInt32BE(-1, 92);
    // port
    payload.writeUInt16BE(port, 96);
    return payload;
  };

  getConnectPayload = () => {
    const payload = Buffer.alloc(16);
    payload.writeUInt32BE(0x417, 0);
    payload.writeUInt32BE(0x27101980, 4);
    payload.writeUInt32BE(udpActions.CONNECT, 8);
    this.transactionId.copy(payload, 12);
    return payload;
  };

  parseResp = (resp) => {
    return {
      protocol: "udp",
      action: resp.readUInt32BE(0),
      transactionId: resp.readUInt32BE(4),
      interval: resp.readUInt32BE(8),
      leechers: resp.readUInt32BE(12),
      seeders: resp.readUInt32BE(16),
      peerList: getPeersList(resp.slice(20)),
    };
  };
}

const getPeersList = (resp) => {
  let peersList = [];
  if (Buffer.isBuffer(resp)) {
    //compact
    for (let i = 0; i < resp.length; i += 6) {
      peersList.push({
        ip: resp.slice(i, i + 4).join("."),
        port: resp.readUInt16BE(i + 4),
      });
    }
  } else {
    // non compact
    for (let i = 0; i < resp.length; i++) {
      peersList.push({
        ip: resp[i].ip.toString(),
        port: resp[i].port,
      });
    }
  }
  return peersList;
};

const getBufferUInt64BE = (n) => {
  buf = Buffer.alloc(8);
  // buf.writeUInt32BE(n >>> 32, 0);
  // buf.writeUInt32BE(n && 0xffffffff, 4);
  buf.writeUInt32BE(n, 4);
  return buf;
};

module.exports = Tracker;
