import { describe, it, expect } from 'vitest';
import { encodeHamming74, decodeHamming74 } from '../protocol/hamming.js';

describe('encodeHamming74', () => {
  it('encodes 4-bit nibble to 7-bit block', () => {
    const result = encodeHamming74('1011');
    expect(result.length).toBe(7);
    expect(result).toMatch(/^[01]{7}$/);
  });

  it('encodes known values correctly', () => {
    // d1=1, d2=0, d3=1, d4=1
    // p1 = d1^d2^d4 = 1^0^1 = 0
    // p2 = d1^d3^d4 = 1^1^1 = 1
    // p3 = d2^d3^d4 = 0^1^1 = 0
    // result: p1 p2 d1 p3 d2 d3 d4 = 0 1 1 0 0 1 1
    expect(encodeHamming74('1011')).toBe('0110011');
  });

  it('encodes all zeros', () => {
    // all parity bits are 0 when data is 0000
    expect(encodeHamming74('0000')).toBe('0000000');
  });

  it('encodes all ones', () => {
    // d1=1,d2=1,d3=1,d4=1
    // p1=1^1^1=1, p2=1^1^1=1, p3=1^1^1=1
    expect(encodeHamming74('1111')).toBe('1111111');
  });
});

describe('decodeHamming74', () => {
  it('decodes a valid block without correction', () => {
    const encoded = encodeHamming74('1011');
    const { nibble, corrected } = decodeHamming74(encoded);
    expect(nibble).toBe('1011');
    expect(corrected).toBe(false);
  });

  it('corrects a single-bit error', () => {
    const encoded = encodeHamming74('1011');
    // Flip bit at position 3 (0-indexed)
    const corrupted =
      encoded.slice(0, 3) +
      (encoded[3] === '0' ? '1' : '0') +
      encoded.slice(4);
    const { nibble, corrected } = decodeHamming74(corrupted);
    expect(nibble).toBe('1011');
    expect(corrected).toBe(true);
  });

  it('round-trips all 16 nibbles', () => {
    for (let i = 0; i < 16; i++) {
      const nibble = i.toString(2).padStart(4, '0');
      const encoded = encodeHamming74(nibble);
      const { nibble: decoded } = decodeHamming74(encoded);
      expect(decoded).toBe(nibble);
    }
  });

  it('corrects single-bit errors in all 7 positions', () => {
    const nibble = '1010';
    const encoded = encodeHamming74(nibble);
    for (let pos = 0; pos < 7; pos++) {
      const bits = encoded.split('');
      bits[pos] = bits[pos] === '0' ? '1' : '0';
      const corrupted = bits.join('');
      const { nibble: decoded, corrected } = decodeHamming74(corrupted);
      expect(decoded).toBe(nibble);
      expect(corrected).toBe(true);
    }
  });

  it('returns fallback for wrong-length input', () => {
    const { nibble } = decodeHamming74('010');
    expect(nibble).toBe('0000');
  });
});
