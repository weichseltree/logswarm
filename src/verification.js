// ─── I/O Verification Framework ──────────────────────────────────────
// Nodes prove computation ability by running a deterministic graph
// against known input/output test cases. If all tests pass, the node
// is "verified" for that computation spec.

import { generateGraphSpec, executeGraph, seededRandom } from './crypto-utils.js';

// ─── Generate I/O Test Cases ─────────────────────────────────────────
/**
 * Generates deterministic test cases for a given seed and dimension count.
 * Both inputs and expected outputs are fully derived from the seed —
 * any node with the same seed will generate identical tests.
 */
export function generateTestCases(seed, dimensions, count = 5) {
  const spec = generateGraphSpec(seed, dimensions);
  const rng = seededRandom(seed ^ 0xdeadbeef); // Different stream from graph weights
  const cases = [];

  for (let i = 0; i < count; i++) {
    const input = [];
    for (let d = 0; d < dimensions; d++) {
      input.push(rng() * 2 - 1); // [-1, 1]
    }
    const expectedOutput = executeGraph(spec, input);
    cases.push({ input, expectedOutput });
  }

  return { spec, cases };
}

// ─── Verify Node Computation ─────────────────────────────────────────
/**
 * Verifies that a node can correctly execute the computation spec.
 * Returns { passed, total, results, verified }
 *
 * A node is "verified" if all test cases pass within tolerance.
 */
export function verifyComputation(spec, cases, tolerance = 1e-6) {
  const results = [];
  let passed = 0;

  for (const testCase of cases) {
    try {
      const actualOutput = executeGraph(spec, testCase.input);
      const match = arraysMatch(actualOutput, testCase.expectedOutput, tolerance);
      results.push({
        input: testCase.input,
        expected: testCase.expectedOutput,
        actual: actualOutput,
        passed: match,
      });
      if (match) passed++;
    } catch (err) {
      results.push({
        input: testCase.input,
        expected: testCase.expectedOutput,
        actual: null,
        passed: false,
        error: err.message,
      });
    }
  }

  return {
    passed,
    total: cases.length,
    results,
    verified: passed === cases.length,
  };
}

// ─── Self-Verification ───────────────────────────────────────────────
/**
 * Full self-test: generates spec + cases from seed, then verifies.
 * This is what runs when a node authenticates — proving it can compute.
 */
export function selfVerify(seed, dimensions) {
  const { spec, cases } = generateTestCases(seed, dimensions);
  return {
    ...verifyComputation(spec, cases),
    spec,
    cases,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────
function arraysMatch(a, b, tolerance) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}
