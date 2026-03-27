import { describe, it, expect } from 'vitest';
import { encodePacketData, processPacketData } from '../protocol/packet.js';

describe('encodePacketData', () => {
  it('returns a binary string of 0s and 1s', () => {
    const encoded = encodePacketData('Hi');
    expect(encoded).toMatch(/^[01]+$/);
  });

  it('output length is a multiple of 7 (Hamming blocks)', () => {
    const encoded = encodePacketData('Hello');
    expect(encoded.length % 7).toBe(0);
  });
});

describe('processPacketData', () => {
  it('round-trips a simple message', () => {
    const encoded = encodePacketData('Hi');
    const { text, valid, corrections } = processPacketData(encoded);
    expect(text).toBe('Hi');
    expect(valid).toBe(true);
    expect(corrections).toBe(0);
  });

  it('round-trips a longer message', () => {
    const msg = 'Hello, Lumina!';
    const encoded = encodePacketData(msg);
    const { text, valid } = processPacketData(encoded);
    expect(text).toBe(msg);
    expect(valid).toBe(true);
  });

  it('detects corruption when checksum mismatches', () => {
    const encoded = encodePacketData('AB');
    // Corrupt many bits to cause unrecoverable error
    const corrupted = encoded.slice(0, -14) + '11111111111111';
    const { valid } = processPacketData(corrupted);
    expect(valid).toBe(false);
  });

  it('handles short input gracefully', () => {
    const { text, valid } = processPacketData('010');
    expect(text).toBe('');
    expect(valid).toBe(false);
  });

  it('can correct single-bit errors per Hamming block', () => {
    const encoded = encodePacketData('A');
    // Flip one bit in the first Hamming block
    const bits = encoded.split('');
    bits[2] = bits[2] === '0' ? '1' : '0';
    const corrupted = bits.join('');
    const { text, valid, corrections } = processPacketData(corrupted);
    expect(text).toBe('A');
    expect(valid).toBe(true);
    expect(corrections).toBeGreaterThan(0);
  });
});
