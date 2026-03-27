import { describe, it, expect } from 'vitest';
import { calculateChecksum } from '../protocol/checksum.js';

describe('calculateChecksum', () => {
  it('returns an 8-bit binary string', () => {
    const result = calculateChecksum('hello');
    expect(result).toMatch(/^[01]{8}$/);
  });

  it('is the XOR of all char codes', () => {
    // 'AB' → 0x41 ^ 0x42 = 0x03 → '00000011'
    expect(calculateChecksum('AB')).toBe('00000011');
  });

  it('returns 00000000 for empty string', () => {
    expect(calculateChecksum('')).toBe('00000000');
  });

  it('single char returns its code in binary', () => {
    // 'A' = 65 = 01000001
    expect(calculateChecksum('A')).toBe('01000001');
  });

  it('XOR of identical chars is 0', () => {
    expect(calculateChecksum('AA')).toBe('00000000');
  });
});
