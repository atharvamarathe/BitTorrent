const parse_torrent = require("./torrent-file-parser");
const fs = require("fs");
const path = require("path");
const Peer = require("./peer");
const Piece = require("./piece");
const messages = require("./messages");
const File = require("./file");
const Tracker = require("./tracker");
const net = require("net");
var log4js = require("log4js");
var logger = log4js.getLogger();

logger.level = "debug";
// logger.level = "warn";

class Torrent {
  static modes = {
    DEFAULT: "default",
    ENDGAME: "endgame",
    COMPLETED: "completed",
  };
  constructor(torrentFile, clientId, port, options = {}) {
    this.metadata = parse_torrent(torrentFile);
    this.clientId = clientId;
    this.port = port;
    this.downloadPath = options.downloadPath || "../downloads/";
    this.upSpeed = 0;
    this.downSpeed = 0;
    this.uploadLimit = options.uploadLimit;
    this.downloadLimit = options.downloadLimit;
    this.maxConnections = options.maxConnections || 30;
    this.peers = [];
    this.mode = Torrent.modes.DEFAULT;
    this.files = [];
    this.uploaded = 0;
    this.downloaded = 0;
    this.pieces = [];
    this.trackers = [];
    this.uploading = false;
    // available only in EndGame mode
    this.missingPieces = {};
    this.inputFileName = torrentFile;
    this.cb = null; // callback function that takes event and payload

    this.downLimitFactor = 0;
    this.upLimitFactor = 0;
    //last recorded data {t: time, n: downloaded/uploaded}
    this.lastDownRecord = null;
    this.lastUpRecord = null;
  }

  get numPieces() {
    return this.metadata.pieces.length / 20;
  }

  updateState = () => {
    let numDone = 0;
    let numActive = 0;
    for (const p of this.pieces) {
      if (p.state === Piece.states.COMPLETE) numDone++;
      else if (p.state === Piece.states.ACTIVE) numActive++;
    }
    this.cb("progress", { numDone });
    if (numDone === this.pieces.length) {
      this.mode = Torrent.modes.COMPLETED;
      this.cb("completed");
      this.shutdown();
    }
    // start ENDGAME mode if we have requested all pieces except one
    else if (
      numDone + numActive === this.pieces.length &&
      numActive <= 20 &&
      this.mode === Torrent.modes.DEFAULT
    ) {
      logger.warn("endgame started");
      this.mode = Torrent.modes.ENDGAME;
      const missing = this.pieces.filter(
        (p) => p.state !== Piece.states.COMPLETE
      );
      for (let m of missing) {
        this.missingPieces[m.index] = m;
      }
    }
    // console.log("progress: ", numDone, "/", this.pieces.length);
  };

  shutdown = () => {
    this.peers.forEach((p) => p.disconnect());
    this.trackers.forEach((t) => t.shutdown());
    clearInterval(this.rateIntervalid);
    // if(t)
    const _closeFiles = () => {
      if (this.pieces.every((p) => p.saved)) {
        this.files.forEach((f) => f.close());
        this.cb("saved");
      } else {
        setTimeout(_closeFiles, 1000);
      }
    };
    _closeFiles();
  };

  updateRates = () => {
    let downSpeed = 0;
    let upSpeed = 0;
    for (const p of this.peers) {
      p.updateDownloadRate();
      downSpeed += p.downstats.rate;
      if (this.uploading) {
        this.updateUploadRate();
        upSpeed += p.upstats.rate;
      }
    }
    this.downSpeed = downSpeed;
    this.upSpeed = upSpeed;
    // this.limitDownloadSpeed();
    // if (this.uploading) this.limitUploadSpeed();
    this.cb("rate-update", { downSpeed, upSpeed });
    this.cb("peers", { peers: this.peers.length });
  };

  limitDownloadSpeed = () => {
    if (!(this.downloadLimit && this.downSpeed > this.downloadLimit)) {
      this.downLimitFactor = 0;
      return;
    }

    const { n, t } = this.lastDownRecord;
    const currtime = new Date().getTime();
    const expectedDelta = (this.downloaded - n) / this.downloadLimit;
    const actualDelta = currtime - t;
    this.downLimitFactor = (expectedDelta - actualDelta) / actualDelta;
    this.lastDownRecord = { t: currtime, n: this.downloaded };

    //throttle specific peers
    let rate = this.downSpeed;
    this.peers.sort((a, b) => b.downstats.rate - a.downstats.rate);
    let i = this.peers.length - 1;
    while (rate > this.downloadLimit && i >= 0) {
      rate -= this.peers[i].downstats.rate;
      this.peers[i].downthrottle = true;
      i--;
    }
  };

  limitUploadSpeed = () => {
    if (!(this.uploadLimit && this.upSpeed > this.uploadLimit)) {
      this.upLimitFactor = 0;
      return;
    }
    const { n, t } = this.lastUpRecord;
    const expectedDelta = (this.uploaded - n) / this.uploadLimit;
    const actualDelta = currtime - t;
    this.upLimitFactor = (expectedDelta - actualDelta) / actualDelta;
    this.lastUpRecord = { t: currtime, n: this.uploaded };

    //throttle specific peers
    let rate = this.upSpeed;
    const receivers = this.peers
      .filter((p) => !p.amChoking)
      .sort((a, b) => b.upstats.rate - a.upstats.rate);
    while (rate > this.uploadLimit && receivers.length) {
      const p = receivers.pop();
      rate -= p.upstats.rate;
      p.upthrottle = true;
    }
  };

  startSeeding = () => {
    if (this.uploading) return;
    this.uploading = true;
    this.topFourIntervalId = setInterval(this.topFour, 30000);
  };

  topFour = () => {
    // if there are 4 or less peers, unchoke all
    if (this.peers.length <= 4) {
      for (const p of this.peers) {
        if (p.state.amChoking) {
          p.state.amChoking = false;
          p.send(messages.getUnChokeMsg());
        }
      }
      return;
    }
    // sort in descending order with respect to download/upload speed (Upload speed is considered if
    // download is complete) and unchoke first 4 who are interested
    if (this.mode === Torrent.modes.COMPLETED) {
      this.peers.sort((a, b) => b.uploadstats.rate - a.uploadstats.rate);
    } else {
      this.peers.sort((a, b) => b.downstats.rate - a.downstats.rate);
    }
    let counter = 0;
    const interestedChoked = [];
    for (const p of this.peers) {
      if (counter < 4 && p.state.peerInterested) {
        counter++;
        if (p.state.amChoking) {
          p.state.amChoking = false;
          p.send(messages.getUnChokeMsg());
        }
      } else {
        if (!p.state.amChoking) {
          p.state.amChoking = true;
          p.send(messages.getChokeMsg());
        }
        if (p.state.peerInterested) {
          interestedChoked.push(p);
        }
      }
    }
    // optimistic unchoke
    if (interestedChoked.length > 0) {
      const opt =
        interestedChoked[Math.floor(Math.random() * interestedChoked.length)];
      opt.amChoking = false;
      opt.send(messages.getUnChokeMsg());
    }
  };

  saveState = () => {
    const state = {
      infoHash: this.metadata.infoHash,
      pieceStates: this.pieces.map((p) => p.state === Piece.states.COMPLETE),
      options: {
        maxConnections: this.maxConnections,
        uploadLimit: this.uploadLimit,
        downloadLimit: this.downloadLimit,
        downloadPath: this.downloadPath,
      },
    };
    fs.writeFile(
      `./.torrent-state-backups/${this.inputFileName}.json`,
      JSON.stringify(state)
    );
  };

  createPieces = () => {
    const { pieces, pieceLength, length } = this.metadata;
    const n = pieces.length / 20;
    let f = 0;

    for (let i = 0; i < n; i++) {
      const included = [];
      const pend = i * pieceLength + pieceLength;

      while (f < this.files.length) {
        included.push(this.files[f]);
        const fend = this.files[f].offset + this.files[f].length;
        if (pend < fend) break;
        else if (pend > fend) f++;
        else {
          f++;
          break;
        }
      }
      let len = pieceLength;
      if (i === n - 1 && length % pieceLength !== 0) {
        len = length % pieceLength;
      }
      this.pieces.push(
        new Piece(
          i,
          i * pieceLength,
          len,
          pieces.slice(i * 20, i * 20 + 20),
          included
        )
      );
    }
  };

  startPeers = (info) => {
    const peerMap = new Set(this.peers.map((p) => p.uniqueId));
    if (info && info.peerList) {
      for (const p of info.peerList) {
        if (!peerMap.has(p.ip + ":" + p.port) && net.isIPv4(p.ip)) {
          if (this.peers.length >= this.maxConnections) break;
          const peer = new Peer(p.ip, p.port, this);
          this.peers.push(peer);
          peer.start();
        }
      }
    }
  };

  createFiles = () => {
    const dest = this.downloadPath + this.metadata.fileName;
    if (this.metadata.files) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { rescursive: true });
      }
      let offset = 0;
      for (const file of this.metadata.files) {
        const filedir = path.join(
          dest,
          ...file.path.slice(0, file.path.length - 1)
        );
        const filepath = path.join(filedir, file.path[file.path.length - 1]);
        if (!fs.existsSync(filedir)) {
          fs.mkdirSync(filedir, { rescursive: true });
        }
        const f = new File(filepath, file.length, offset);
        f.open((err) => logger.error(err));
        this.files.push(f);
        offset += file.length;
      }
    } else {
      if (!fs.existsSync(this.downloadPath)) {
        fs.mkdirSync(this.downloadPath, { rescursive: true });
      }
      const f = new File(dest, this.metadata.length, 0);
      f.open((err) => logger.error(err));
      this.files.push(f);
    }
  };

  start = (cb) => {
    this.cb = cb;
    this.createFiles();
    this.createPieces();
    // console.log(this.pieces);
    if (this.metadata.announce) {
      this.trackers.push(new Tracker(this.metadata.announce, this));
    }
    if (this.metadata.announceList) {
      for (const a of this.metadata.announceList) {
        this.trackers.push(new Tracker(a, this));
      }
    }
    for (const t of this.trackers) {
      t.announce(Tracker.events.STARTED, (err, info) => {
        this.startPeers(info);
      });
    }
    this.lastDownRecord = {
      t: new Date().getTime(),
      n: 0,
    };
    this.lastUpRecord = {
      t: new Date().getTime(),
      n: 0,
    };
    this.rateIntervalid = setInterval(this.updateRates, 1000);
  };
}

module.exports = Torrent;
