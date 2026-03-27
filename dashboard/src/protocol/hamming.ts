/**
 * Hamming(7,4) forward-error-correction codec.
 *
 * Encodes 4 data bits into 7 bits (3 parity bits), capable of correcting
 * any single-bit error in the received 7-bit block.
 */

/** Encode a 4-bit nibble (string of '0'/'1') into a 7-bit Hamming block. */
export function encodeHamming74(nibble: string): string {
  const d1 = parseInt(nibble[0]);
  const d2 = parseInt(nibble[1]);
  const d3 = parseInt(nibble[2]);
  const d4 = parseInt(nibble[3]);

  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;

  return `${p1}${p2}${d1}${p3}${d2}${d3}${d4}`;
}

/** Decode a 7-bit Hamming block, returning the corrected 4-bit nibble. */
export function decodeHamming74(block: string): {
  nibble: string;
  corrected: boolean;
} {
  if (block.length !== 7) return { nibble: '0000', corrected: false };

  const bits = block.split('').map(Number);
  const [p1, p2, d1, p3, d2, d3, d4] = bits;

  const s1 = p1 ^ d1 ^ d2 ^ d4;
  const s2 = p2 ^ d1 ^ d3 ^ d4;
  const s3 = p3 ^ d2 ^ d3 ^ d4;

  const syndrome = s1 * 1 + s2 * 2 + s3 * 4;
  let corrected = false;

  if (syndrome !== 0 && syndrome <= 7) {
    corrected = true;
    bits[syndrome - 1] ^= 1;
  }

  return { nibble: `${bits[2]}${bits[4]}${bits[5]}${bits[6]}`, corrected };
}
