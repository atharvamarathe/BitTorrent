const BitVector = require("./util/bitvector");
const crypto = require("crypto");

var log4js = require("log4js");
var logger = log4js.getLogger("piece.js");
logger.level = "debug";
const util = require("util");

class Piece {
  static states = {
    ACTIVE: "active",
    PENDING: "pending",
    COMPLETE: "complete",
    INCOMPLETE: "incomplete",
  };
  static BlockLength = Math.pow(2, 14);

  constructor(index, offset, len, hash, files) {
    this.hash = hash;
    this.index = index;
    this.offset = offset;
    this.length = len;
    this.count = 0;
    this.state = Piece.states.PENDING;
    this.numBlocks = Math.ceil(this.length / Piece.BlockLength);
    this.completedBlocks = new BitVector(this.numBlocks);
    this.data = Buffer.alloc(len);
    this.saved = false;
    this.files = files;
  }

  saveBlock = (begin, block) => {
    if (this.state === Piece.states.COMPLETE) return true;
    block.copy(this.data, begin);
    this.completedBlocks.set(begin / Piece.BlockLength);
    if (this.isComplete()) {
      this.writePiece();
      return true;
    } else return false;
  };

  getData = (begin, length) => {
    return new Promise((resolve, reject) => {
      if (!this.data) {
        this.readPiece()
          .then(() => {
            resolve(this.data.slice(begin, begin + length));
          })
          .catch((err) => logger.error(err));
      } else {
        resolve(this.data.slice(begin, begin + length));
      }
    });
  };

  writePiece = () => {
    logger.debug(this);
    for (const f of this.files) {
      f.write(this.data, this.offset, (err) => {
        if (err) logger.error(err);
        this.data = null;
        this.saved = true;
      });
    }
  };

  readPiece = () => {
    return new Promise((resolve, reject) => {
      let c = 0;
      this.data = Buffer.alloc(this.length);
      for (const f of this.files) {
        f.read(this.data, this.offset, (err) => {
          reject(err);
          c += 1;
          if (c === this.files.length) return resolve();
        });
      }
    });
  };

  isComplete = () => {
    if (this.completedBlocks.count() === this.numBlocks) {
      let shasum = crypto.createHash("sha1").update(this.data).digest();
      if (!this.hash.compare(shasum)) {
        this.state = Piece.states.COMPLETE;
        logger.info(`piece verified, index : ${this.index}`);
        return true;
      } else {
        this.state = Piece.states.PENDING;
        this.completedBlocks = new BitVector(this.numBlocks);
        return false;
      }
    }
    return false;
  };

  [util.inspect.custom](depth, opts) {
    return JSON.stringify({
      index: this.index,
      state: this.state,
      length: this.length,
      progress: `${this.completedBlocks.count()}/${this.numBlocks}`,
    });
  }
}

module.exports = Piece;
