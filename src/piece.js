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

  constructor(index, len, hash) {
    this.hash = hash;
    this.index = index;
    this.length = len;
    this.count = 0;
    this.state = Piece.states.PENDING;
    this.numBlocks = Math.ceil(this.length / Piece.BlockLength);
    this.completedBlocks = new BitVector(this.numBlocks);
    this.data = Buffer.alloc(len);
  }

  saveBlock = (begin, block) => {
    block.copy(this.data, begin);
    this.completedBlocks.set(begin / Piece.BlockLength);
    return this.isComplete();
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
