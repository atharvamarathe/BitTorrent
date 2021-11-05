/**
 * Original source: https://github.com/chrisakroyd/bit-vec/blob/main/src/index.js
 * Modifications: conversions to/from buffer, and other changes to meet project requirements)
 */

class BitVector {
  /**
   * BitVector constructor.
   *
   * @constructor
   * @param {Number} size -> Size of the buffer in bits.
   */
  constructor(size) {
    this.buf = new Buffer.alloc(Math.ceil(size / 8));
    this.bitsPerElem = this.buf.BYTES_PER_ELEMENT * 8;
  }

  /**
   *  .bits() + .length() are semi-dynamic properties that may change frequently,
   *  therefore these are computed on the fly via getters.
   */
  get bits() {
    return this.bitsPerElem * this.buf.length;
  }

  get length() {
    return this.buf.length;
  }

  get bitVector() {
    return this.buf;
  }

  set bitVector(bitbuffer) {
    this.buf = bitbuffer;
  }

  /**
   * Clears the bit at the given index.
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @throws {RangeError} Throws range error if index is out of range.
   */
  rangeCheck(index) {
    if (index >= this.bits || index < 0) {
      throw new RangeError(
        `Given index ${index} out of range of bit vector length ${this.bits}`
      );
    }
  }

  /**
   * `bitVec.get(index)`
   * Performs a get operation on the given index, retrieving the stored value (0 or 1).
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @return {Number} Returns number, 1 if set, 0 otherwise.
   */
  get(index) {
    this.rangeCheck(index);
    const byteIndex = Math.floor(index / this.bitsPerElem);
    const bitIndex = index % this.bitsPerElem;

    let v = this.buf[byteIndex] & (1 << (this.bitsPerElem - bitIndex - 1));
    return v > 0 ? 1 : 0;
  }

  /**
   * `bitVec.set(index)`
   * Performs a set operation on the given index, setting the value to either 0 or 1.
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @param {Number} value -> Number, 0 or 1, defaults to 1.
   * @return {BitVector} Returns `BitVector` for chaining with the bit cleared.
   */
  set(index, value = 1) {
    this.rangeCheck(index);
    const byteIndex = Math.floor(index / this.bitsPerElem);
    const bitIndex = this.bitsPerElem - 1 - (index % this.bitsPerElem);

    if (value) {
      this.buf[byteIndex] |= 1 << bitIndex;
    } else {
      this.buf[byteIndex] &= ~(1 << bitIndex);
    }
    return this;
  }

  /**
   * `bitVec.clear(index)`
   * Clears the bit at the given index.
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @return {BitVector} Returns `BitVector` for chaining with the bit cleared.
   */
  clear(index) {
    return this.set(index, 0);
  }

  /**
   * `bitVec.flip(index)`
   * Flips the bit at the given index.
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @return {BitVector} Returns `BitVector` for chaining with the bit cleared.
   */
  flip(index) {
    this.rangeCheck(index);
    const byteIndex = Math.floor(index / this.bitsPerElem);
    const bitIndex = this.bitsPerElem - 1 - (index % this.bitsPerElem);
    this.buf[byteIndex] ^= 1 << bitIndex;
    return this;
  }

  /**
   * `bitVec.test(index)`
   * Tests whether the given index is set to 1.
   *
   * @param {Number} index -> Number for index: 0 <= index < bitVec.bits.
   * @return {Boolean} Returns Boolean `true` if index is set, `false` otherwise .
   */
  test(index) {
    return this.get(index) === 1;
  }

  /**
   * `bitVec.count()`
   * Counts the number of set bits in the bit vector.
   *
   * @return {Number} Number of indices currently set to 1.
   */
  count() {
    let c = 0;
    for (let i = 0; i < this.buf.length; i += 1) {
      c += countBits(this.buf[i]);
    }
    return c;
  }

  /**
   * `bitVec.setRange(begin, end, value = 1)`
   * Sets a range of bits from begin to end.
   *
   * @param {Number} begin -> Number for index: 0 <= index < bitVec.bits.
   * @param {Number} end -> Number for index: 0 <= index < bitVec.bits.
   * @param {Number} value -> The value to set the index to (0 or 1).
   * @return {BitVector} Returns `BitVector` for chaining with the bits set.
   */
  setRange(begin, end, value = 1) {
    for (let i = begin; i < end; i += 1) {
      this.set(i, value);
    }
    return this;
  }

  /**
   * `bitVec.clearRange(begin, end)`
   * Clears a range of bits from begin to end.
   *
   * @param {Number} begin -> Number for index: 0 <= index < bitVec.bits.
   * @param {Number} end -> Number for index: 0 <= index < bitVec.bits.
   * @return {BitVector} Returns `BitVector` for chaining with the bits set.
   */
  clearRange(begin, end) {
    this.setRange(begin, end, 0);
    return this;
  }

  /**
   * `bitVec.shortLong(bitVec)`
   *  Useful function allowing for the comparison of two differently sized BitVector's.
   *  Simply returns the short and long buffers.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {Object} Returns object with two keys of type `BitVector`,
   *                  short = shorter bit vector, long = longer bit vector.
   */
  shortLong(that) {
    let short;
    let long;

    if (that.length < this.length) {
      short = that.buffer;
      long = this.buf;
    } else {
      short = this.buf;
      long = that.buffer;
    }

    return { short, long };
  }

  /**
   * `bitVec.or(bitVec)`
   * Performs the bitwise or operation between two BitVectors and returns the result as a
   * new BitVector object.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns new `BitVector` object with the result of the operation.
   */
  or(bitVec) {
    // Get short and long buffers, assign correct variables -> for ops between two diff sized buffers.
    const { short, long } = this.shortLong(bitVec);
    const buffer = new Buffer.alloc(long.length);

    // Perform operation over shorter buffer.
    for (let i = 0; i < short.length; i += 1) {
      buffer[i] = short[i] | long[i];
    }

    // Fill in the remaining unchanged numbers from the longer buffer.
    for (let j = short.length; j < long.length; j += 1) {
      buffer[j] = long[j];
    }

    // Return a new BitVector object.
    return BitVector.fromBuffer(buffer);
  }

  /**
   * `bitVec.xor(bitVec)`
   * Performs the bitwise xor operation between two BitVectors and returns the result as a
   * new BitVector object.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns new `BitVector` object with the result of the operation.
   */
  xor(bitVec) {
    // Get short and long buffers, assign correct variables -> for ops between two diff sized buffers.
    const { short, long } = this.shortLong(bitVec);
    const buffer = new Buffer.alloc(long.length);

    // Perform operation over shorter buffer.
    for (let i = 0; i < short.length; i += 1) {
      buffer[i] = short[i] ^ long[i];
    }

    // Fill in the remaining numbers from the longer buffer.
    for (let j = short.length; j < long.length; j += 1) {
      buffer[j] = 0 ^ long[j];
    }

    // Return a new BitVector object.
    return BitVector.fromBuffer(buffer);
  }

  /**
   * `bitVec.and(bitVec)`
   * Performs the bitwise and operation between two BitVectors and returns the result as a
   * new BitVector object.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns new `BitVector` object with the result of the operation.
   */
  and(bitVec) {
    // Get short and long buffers, assign correct variables -> for ops between two diff sized buffers.
    const { short, long } = this.shortLong(bitVec);
    const buffer = new Buffer.alloc(long.length);

    // Perform operation over shorter buffer.
    for (let i = 0; i < short.length; i += 1) {
      buffer[i] = short[i] & long[i];
    }

    // Fill in the remaining unchanged numbers from the longer buffer.
    for (let j = short.length; j < long.length; j += 1) {
      buffer[j] = long[j];
    }

    // Return a new BitVector object.
    return BitVector.fromBuffer(buffer);
  }

  /**
   * `bitVec.equals(otherBitVec)`
   * Determines if two bit vectors are equal.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {Boolean} Returns Boolean `true` if the two bit vectors are equal, `false` otherwise.
   */
  equals(bitVec) {
    const { short, long } = this.shortLong(bitVec);

    for (let i = 0; i < short.length; i += 1) {
      if (short[i] !== long[i]) {
        return false;
      }
    }

    // If the longer buffer is all 0 then they are equal, if not then they are not.
    // equiv to padding shorter bit buffer to larger buffer length and comparing.
    // Allows comparisons along vecs of different length.
    for (let j = short.length; j < long.length; j += 1) {
      if (long[j] !== 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * `bitVec.notEquals(otherBitVec)`
   * Determines if two bit vectors are not equal.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {Boolean} Returns Boolean `true` if the two bit vectors are not equal,
   *                   `false` otherwise.
   */
  notEquals(bitVec) {
    return !this.equals(bitVec);
  }

  /**
   * `bitVec.not()`
   * Performs the bitwise not operation on this BitVector and returns the result as a
   * new BitVector object.
   *
   * @return {BitVector} Returns new `BitVector` object with the result of the operation.
   */
  not() {
    const buffer = new Buffer.alloc(this.buf.length);

    for (let i = 0; i < this.buf.length; i += 1) {
      buffer[i] = ~this.buf[i];
    }

    return BitVector.fromBuffer(buffer);
  }

  /**
   * `bitVec.invert()`
   *
   * Inverts this BitVector, alias of .not().
   *
   * @return {BitVector} Returns new `BitVector` object with the result of the operation.
   */
  invert() {
    this.buf = this.not().buffer;
    return this;
  }

  /**
   * `bitVec.orEqual(bitVec)`
   * Performs the bitwise or operation between two BitVectors and assigns the result to
   * this BitVector.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns `this` for chaining with the bits set.
   */
  orEqual(bitVec) {
    this.buf = this.or(bitVec).buffer;
    return this;
  }

  /**
   * `bitVec.xorEqual(bitVec)`
   * Performs the bitwise xor operation between two BitVectors and assigns the result to
   * this BitVector.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns `this` for chaining with the bits set.
   */
  xorEqual(bitVec) {
    this.buf = this.xor(bitVec).buffer;
    return this;
  }

  /**
   * `bitVec.andEqual(bitVec)`
   * Performs the bitwise and operation between two BitVectors and assigns the result to
   * this BitVector.
   *
   * @param {BitVector} bitVec -> BitVector, instance of BitVector class.
   * @return {BitVector} Returns `this` for chaining with the bits set.
   */
  andEqual(bitVec) {
    this.buf = this.and(bitVec).buffer;
    return this;
  }

  /**
   * `bitVec.notEqual(bitVec)`
   * Performs the bitwise not operation between two BitVectors and assigns the result to
   * this BitVector.
   *
   * @return {BitVector} Returns `this` for chaining with the bits set.
   */
  notEqual() {
    this.buf = this.not().buffer;
    return this;
  }

  /**
   * `bitVec.isEmpty()`
   * Tests whether this BitVector has any set bits.
   *
   * @return {Boolean} Returns Boolean `true` if the bit vector has no set bits, `false` otherwise.
   */
  isEmpty() {
    for (let i = 0; i < this.buf.length; i += 1) {
      if (this.buf[i] !== 0) {
        return false;
      }
    }
    return true;
  }

  toBuffer() {
    return this.buf;
  }

  print() {
    console.log(
      [...this.buf].map((s) => s.toString(2).padStart(8, "0")).join(" ")
    );
  }

  static fromBuffer(buf) {
    const newBitVec = new BitVector(0);
    newBitVec.buffer = buf;
    return newBitVec;
  }
}

const countBits = (count) => {
  let n = count;
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
};

module.exports = BitVector;

// const v = new BitVector(15);
// const f = new BitVector(15);

// v.set(5);
// f.set(6);
// v.print();
// f.print();
// v.setRange(8, 12);
// v.print();
// v.clearRange(6, 9);
// v.print();
// v.clear(11);
// v.print();
