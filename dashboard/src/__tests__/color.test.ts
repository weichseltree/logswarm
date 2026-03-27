import { describe, it, expect } from 'vitest';
import { classifyColor, isProtocolColor } from '../protocol/color.js';

describe('classifyColor', () => {
  it('classifies pure white', () => {
    expect(classifyColor(255, 255, 255)).toBe('WHITE');
  });

  it('classifies near-white', () => {
    expect(classifyColor(210, 210, 210)).toBe('WHITE');
  });

  it('classifies pure black', () => {
    expect(classifyColor(0, 0, 0)).toBe('BLACK');
  });

  it('classifies near-black', () => {
    expect(classifyColor(50, 50, 50)).toBe('BLACK');
  });

  it('classifies saturated red', () => {
    expect(classifyColor(255, 0, 0)).toBe('RED');
  });

  it('classifies saturated green', () => {
    expect(classifyColor(0, 255, 0)).toBe('GREEN');
  });

  it('classifies saturated blue', () => {
    expect(classifyColor(0, 0, 255)).toBe('BLUE');
  });

  it('classifies yellow', () => {
    expect(classifyColor(255, 255, 0)).toBe('YELLOW');
  });

  it('classifies ambiguous as UNKNOWN', () => {
    expect(classifyColor(128, 128, 128)).toBe('UNKNOWN');
  });
});

describe('isProtocolColor', () => {
  it('returns true for all 5 protocol colors', () => {
    expect(isProtocolColor('RED')).toBe(true);
    expect(isProtocolColor('GREEN')).toBe(true);
    expect(isProtocolColor('BLUE')).toBe(true);
    expect(isProtocolColor('WHITE')).toBe(true);
    expect(isProtocolColor('YELLOW')).toBe(true);
  });

  it('returns false for BLACK', () => {
    expect(isProtocolColor('BLACK')).toBe(false);
  });

  it('returns false for UNKNOWN', () => {
    expect(isProtocolColor('UNKNOWN')).toBe(false);
  });
});
