/**
 * Hungarian algorithm (Munkres) for optimal assignment of detections
 * to tracked sources.
 *
 * Solves the assignment problem on an n×m cost matrix in O(n²m) time.
 * For our use case n,m < 20, so this is effectively instant.
 */

/**
 * Find the optimal assignment that minimizes total cost.
 *
 * @param costMatrix  n×m cost matrix (n = rows/workers, m = cols/jobs).
 *                    costMatrix[i][j] = cost of assigning row i to col j.
 * @returns Array of [rowIndex, colIndex] pairs representing the optimal
 *          assignment. Length = min(n, m).
 */
export function hungarian(costMatrix: number[][]): [number, number][] {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0].length;
  if (m === 0) return [];

  // Pad to square if needed
  const sz = Math.max(n, m);
  const cost: number[][] = [];
  for (let i = 0; i < sz; i++) {
    cost[i] = [];
    for (let j = 0; j < sz; j++) {
      cost[i][j] = i < n && j < m ? costMatrix[i][j] : 0;
    }
  }

  // u[i], v[j] = potential for row i / col j
  const u = new Float64Array(sz + 1);
  const v = new Float64Array(sz + 1);
  // p[j] = row assigned to col j (1-indexed, 0 = unassigned)
  const p = new Int32Array(sz + 1);
  // way[j] = previous col in augmenting path
  const way = new Int32Array(sz + 1);

  for (let i = 1; i <= sz; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(sz + 1).fill(Infinity);
    const used = new Uint8Array(sz + 1);

    do {
      used[j0] = 1;
      let i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= sz; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= sz; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Augment path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Extract assignment (only for original rows/cols)
  const result: [number, number][] = [];
  for (let j = 1; j <= sz; j++) {
    const row = p[j] - 1;
    const col = j - 1;
    if (row < n && col < m) {
      result.push([row, col]);
    }
  }

  return result;
}
