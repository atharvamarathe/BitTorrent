const BitVector = require("./util/bitvector");
const crypto = require("crypto");

var log4js = require("log4js");
var logger = log4js.getLogger();
logger.level = "debug";

class Piece {
  static states = {
    ACTIVE: "active",
    PENDING: "pending",
    COMPLETE: "complete",
  };

  static BlockLength = Math.pow(2, 14);

  constructor(index, len, hash, files) {
    this.hash = hash;
    this.index = index;
    this.length = len;
    this.count = 0;
    this.state = Piece.states.PENDING;
    this.numBlocks = Math.ceil(this.length / Piece.BlockLength);
    this.completedBlocks = new BitVector(this.numBlocks);
    this.data = Buffer.alloc(len);
    this.files = files;
  }

  saveBlock = (begin, block) => {
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
    for (let i = 0; i < this.files.length; i++) {
      this.files[i].write(this.data, this.index * this.length, (err) => {
        if (err) logger.error(err);
        this.data = null;
      });
    }
  };

  readPiece = () => {
    return new Promise((resolve, reject) => {
      let count = 0;
      this.data = Buffer.alloc(this.length);
      for (let i = 0; i < this.files.length; i++) {
        this.files[i].read(this.data, this.index * this.length, (err) => {
          reject(err);
          count += 1;
          if (count === this.files.length) return resolve();
        });
      }
    });
  };

  isComplete = () => {
    if (this.completedBlocks.count() === this.numBlocks) {
      //   console.debug("got all pieces for piece : ", this.index);
      let shasum = crypto.createHash("sha1").update(this.data).digest();
      if (!this.hash.compare(shasum)) {
        this.state = Piece.states.COMPLETE;
        logger.warn(`piece downloaded and verified, index : ${this.index}`);
        return true;
      } else {
        this.state = Piece.states.PENDING;
        this.completedBlocks = new BitVector(this.numBlocks);
        return false;
      }
    }
    return false;
  };
}

module.exports = Piece;
