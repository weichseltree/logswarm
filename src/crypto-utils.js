/**
 * Hashes a secret string using SHA-256 and returns the hex digest.
 * Used to map user-entered secrets to Firestore document IDs without
 * storing the plaintext secret.
 */
export async function hashSecret(secret) {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a cryptographically random node ID (hex string).
 */
export function generateNodeId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Prime Decomposition ─────────────────────────────────────────────
/**
 * Decomposes a positive integer into its prime factors.
 * Returns sorted array of primes (with repetition).
 * e.g. 12 → [2, 2, 3], 67 → [67], 42 → [2, 3, 7]
 */
export function primeFactors(n) {
  if (n < 2) return [];
  const factors = [];
  let d = 2;
  while (d * d <= n) {
    while (n % d === 0) {
      factors.push(d);
      n = Math.floor(n / d);
    }
    d++;
  }
  if (n > 1) factors.push(n);
  return factors;
}

/**
 * Returns unique prime factors (no repetition).
 */
export function uniquePrimeFactors(n) {
  return [...new Set(primeFactors(n))];
}

// ─── Deterministic Seed from Secret ──────────────────────────────────
/**
 * Derives a numeric seed from a secret string.
 * The seed is deterministic — same input always produces the same seed.
 * Uses the first 8 bytes of SHA-256 as a 64-bit integer (capped to safe int range).
 */
export async function deriveSeed(secret) {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const view = new DataView(hashBuffer);
  // Use first 6 bytes to stay within Number.MAX_SAFE_INTEGER
  const hi = view.getUint16(0);
  const lo = view.getUint32(2);
  return hi * 0x100000000 + lo;
}

/**
 * Derives a full computation specification from a secret.
 * Returns: { hash, seed, primes, signature, dimensions }
 *
 * - hash: SHA-256 hex (for Firestore IDs — backwards compatible)
 * - seed: deterministic numeric seed
 * - primes: prime factorization of the seed
 * - signature: unique primes (defines topology & locked tiles)
 * - dimensions: number of unique primes (the N in N-dimensional)
 */
export async function deriveComputeSpec(secret) {
  const hash = await hashSecret(secret);
  const seed = await deriveSeed(secret);
  const primes = primeFactors(seed);
  const signature = [...new Set(primes)];
  return {
    hash,
    seed,
    primes,
    signature,
    dimensions: signature.length,
  };
}

// ─── Deterministic PRNG (Mulberry32) ─────────────────────────────────
/**
 * Seeded 32-bit PRNG. Same seed always produces the same sequence.
 * Returns a function that yields the next float in [0, 1).
 */
export function seededRandom(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Deterministic Graph Spec from Seed ──────────────────────────────
/**
 * Generates a computation graph specification from a seed.
 * The graph is a DAG of operations that can be verified against I/O pairs.
 * Uses the seeded PRNG to select operations deterministically.
 */
export function generateGraphSpec(seed, dimensions) {
  const rng = seededRandom(seed);
  const ops = ['add', 'mul', 'relu', 'sigmoid', 'tanh', 'linear', 'norm'];
  const layers = Math.max(2, Math.min(dimensions, 8));
  const graph = [];

  for (let i = 0; i < layers; i++) {
    const opIdx = Math.floor(rng() * ops.length);
    const inputDim = i === 0 ? dimensions : graph[i - 1].outputDim;
    const outputDim = Math.max(1, Math.floor(rng() * dimensions) + 1);
    const weights = [];

    // Generate deterministic weights for this layer
    for (let w = 0; w < inputDim * outputDim; w++) {
      weights.push(rng() * 2 - 1); // [-1, 1]
    }

    graph.push({
      layer: i,
      op: ops[opIdx],
      inputDim,
      outputDim,
      weights,
    });
  }

  return { seed, dimensions, layers, graph };
}

// ─── Execute Graph Spec Against Input ────────────────────────────────
/**
 * Runs a computation graph spec on an input vector.
 * Returns the output vector. Used for I/O verification.
 */
export function executeGraph(spec, input) {
  let current = Array.isArray(input) ? [...input] : [input];

  for (const layer of spec.graph) {
    const { op, inputDim, outputDim, weights } = layer;

    // Pad or truncate input to match expected dimension
    while (current.length < inputDim) current.push(0);
    current = current.slice(0, inputDim);

    // Matrix multiply: weights is [inputDim x outputDim]
    const output = new Array(outputDim).fill(0);
    for (let o = 0; o < outputDim; o++) {
      for (let i = 0; i < inputDim; i++) {
        output[o] += current[i] * weights[i * outputDim + o];
      }
    }

    // Apply activation
    current = output.map((v) => applyOp(op, v));
  }

  return current;
}

function applyOp(op, x) {
  switch (op) {
    case 'add': return x + 0.5;
    case 'mul': return x * 0.5;
    case 'relu': return Math.max(0, x);
    case 'sigmoid': return 1 / (1 + Math.exp(-x));
    case 'tanh': return Math.tanh(x);
    case 'linear': return x;
    case 'norm': return x / (Math.abs(x) + 1e-8);
    default: return x;
  }
}
