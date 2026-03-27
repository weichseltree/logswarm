import { describe, it, expect } from 'vitest';
import {
  hashSecret,
  generateNodeId,
  primeFactors,
  uniquePrimeFactors,
  deriveSeed,
  deriveComputeSpec,
  seededRandom,
  generateGraphSpec,
  executeGraph,
} from '../crypto-utils.js';

// ─── hashSecret ──────────────────────────────────────────────────────

describe('hashSecret', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await hashSecret('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces known SHA-256 for empty string', async () => {
    const hash = await hashSecret('');
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is deterministic — same input → same hash', async () => {
    const a = await hashSecret('hello');
    const b = await hashSecret('hello');
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', async () => {
    const a = await hashSecret('67');
    const b = await hashSecret('68');
    expect(a).not.toBe(b);
  });
});

// ─── generateNodeId ──────────────────────────────────────────────────

describe('generateNodeId', () => {
  it('returns a 32-char hex string', () => {
    const id = generateNodeId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateNodeId()));
    expect(ids.size).toBe(20);
  });
});

// ─── primeFactors ────────────────────────────────────────────────────

describe('primeFactors', () => {
  it('returns [] for n < 2', () => {
    expect(primeFactors(0)).toEqual([]);
    expect(primeFactors(1)).toEqual([]);
    expect(primeFactors(-5)).toEqual([]);
  });

  it('returns [n] for primes', () => {
    expect(primeFactors(2)).toEqual([2]);
    expect(primeFactors(67)).toEqual([67]);
  });

  it('decomposes composites correctly', () => {
    expect(primeFactors(12)).toEqual([2, 2, 3]);
    expect(primeFactors(42)).toEqual([2, 3, 7]);
    expect(primeFactors(100)).toEqual([2, 2, 5, 5]);
  });
});

// ─── uniquePrimeFactors ──────────────────────────────────────────────

describe('uniquePrimeFactors', () => {
  it('removes duplicates', () => {
    expect(uniquePrimeFactors(12)).toEqual([2, 3]);
    expect(uniquePrimeFactors(100)).toEqual([2, 5]);
  });

  it('handles primes', () => {
    expect(uniquePrimeFactors(7)).toEqual([7]);
  });
});

// ─── deriveSeed ──────────────────────────────────────────────────────

describe('deriveSeed', () => {
  it('returns a positive integer', async () => {
    const seed = await deriveSeed('test');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThan(0);
  });

  it('is deterministic', async () => {
    const a = await deriveSeed('secret');
    const b = await deriveSeed('secret');
    expect(a).toBe(b);
  });

  it('stays within safe integer range', async () => {
    const seed = await deriveSeed('large-value-test');
    expect(seed).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});

// ─── deriveComputeSpec ───────────────────────────────────────────────

describe('deriveComputeSpec', () => {
  it('returns all expected fields', async () => {
    const spec = await deriveComputeSpec('test');
    expect(spec).toHaveProperty('hash');
    expect(spec).toHaveProperty('seed');
    expect(spec).toHaveProperty('primes');
    expect(spec).toHaveProperty('signature');
    expect(spec).toHaveProperty('dimensions');
  });

  it('hash is a valid SHA-256 hex', async () => {
    const spec = await deriveComputeSpec('test');
    expect(spec.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dimensions equals length of signature', async () => {
    const spec = await deriveComputeSpec('test');
    expect(spec.dimensions).toBe(spec.signature.length);
  });

  it('signature contains only unique primes', async () => {
    const spec = await deriveComputeSpec('test');
    expect(new Set(spec.signature).size).toBe(spec.signature.length);
  });
});

// ─── seededRandom ────────────────────────────────────────────────────

describe('seededRandom', () => {
  it('returns values in [0, 1)', () => {
    const rng = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic — same seed → same sequence', () => {
    const a = seededRandom(123);
    const b = seededRandom(123);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    let same = true;
    for (let i = 0; i < 10; i++) {
      if (a() !== b()) same = false;
    }
    expect(same).toBe(false);
  });
});

// ─── generateGraphSpec / executeGraph ────────────────────────────────

describe('generateGraphSpec + executeGraph', () => {
  it('generates a graph with the expected structure', () => {
    const spec = generateGraphSpec(42, 3);
    expect(spec.seed).toBe(42);
    expect(spec.dimensions).toBe(3);
    expect(spec.graph.length).toBeGreaterThanOrEqual(2);
    for (const layer of spec.graph) {
      expect(layer).toHaveProperty('op');
      expect(layer).toHaveProperty('inputDim');
      expect(layer).toHaveProperty('outputDim');
      expect(layer).toHaveProperty('weights');
    }
  });

  it('executeGraph produces a deterministic output', () => {
    const spec = generateGraphSpec(42, 3);
    const a = executeGraph(spec, [1, 2, 3]);
    const b = executeGraph(spec, [1, 2, 3]);
    expect(a).toEqual(b);
  });

  it('different inputs produce different outputs', () => {
    const spec = generateGraphSpec(42, 3);
    const a = executeGraph(spec, [1, 0, 0]);
    const b = executeGraph(spec, [0, 0, 1]);
    expect(a).not.toEqual(b);
  });
});
