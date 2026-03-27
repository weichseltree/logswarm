/**
 * 2D Kalman filter for tracking optical source centroids.
 *
 * State vector: [x, y, vx, vy]
 * Measurement:  [x, y]
 *
 * Constant-velocity model with tunable process noise (acceleration
 * uncertainty) and measurement noise (centroid jitter).
 */

export interface KalmanState {
  /** State vector [x, y, vx, vy]. */
  x: Float64Array;
  /** 4×4 covariance matrix (row-major). */
  P: Float64Array;
}

// ── Default noise parameters ──────────────────────────────────────────

/** Process noise: acceleration standard deviation (px/frame²). */
const DEFAULT_SIGMA_ACCEL = 2.0;
/** Measurement noise: centroid position standard deviation (px). */
const DEFAULT_SIGMA_MEAS = 8.0;

// ── Matrix helpers (4×4 and 2×4, zero-alloc via module-scope scratch buffers) ────
//
// Scratch buffers — reused across kalmanPredict / kalmanUpdate calls to avoid
// per-frame Float64Array allocations and GC pressure.
const _scratch4x4_a = new Float64Array(16); // general-purpose scratch A
const _scratch4x4_b = new Float64Array(16); // general-purpose scratch B
const _scratch4x4_c = new Float64Array(16); // general-purpose scratch C
const _scratchQ = new Float64Array(16);     // process noise Q
const _scratchK = new Float64Array(8);      // 4×2 Kalman gain

function mat4identity(): Float64Array {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4set(m: Float64Array, r: number, c: number, v: number): void {
  m[r * 4 + c] = v;
}

function mat4get(m: Float64Array, r: number, c: number): number {
  return m[r * 4 + c];
}

/** C = A * B (both 4×4). */
function mat4mul(A: Float64Array, B: Float64Array, C: Float64Array): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += mat4get(A, i, k) * mat4get(B, k, j);
      mat4set(C, i, j, s);
    }
  }
}

/** C = A + B (4×4). */
function mat4add(A: Float64Array, B: Float64Array, C: Float64Array): void {
  for (let i = 0; i < 16; i++) C[i] = A[i] + B[i];
}

/** C = Aᵀ (4×4). */
function mat4transpose(A: Float64Array, C: Float64Array): void {
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) mat4set(C, j, i, mat4get(A, i, j));
}

// ── 2×2 inverse (for the innovation covariance) ─────────────────────

function inv2x2(
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number, number, number] {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1]; // fallback to identity
  const invDet = 1 / det;
  return [d * invDet, -b * invDet, -c * invDet, a * invDet];
}

// ── Public API ───────────────────────────────────────────────────────

export interface KalmanConfig {
  sigmaAccel: number;
  sigmaMeas: number;
}

const DEFAULT_CONFIG: KalmanConfig = {
  sigmaAccel: DEFAULT_SIGMA_ACCEL,
  sigmaMeas: DEFAULT_SIGMA_MEAS,
};

/**
 * Create a new Kalman filter initialized at the given position.
 */
export function createKalman(
  cx: number,
  cy: number,
  config: KalmanConfig = DEFAULT_CONFIG,
): KalmanState {
  const x = new Float64Array([cx, cy, 0, 0]);

  // Initial covariance: certain about position, uncertain about velocity
  const P = mat4identity();
  mat4set(P, 0, 0, config.sigmaMeas ** 2);
  mat4set(P, 1, 1, config.sigmaMeas ** 2);
  mat4set(P, 2, 2, 100); // velocity uncertainty
  mat4set(P, 3, 3, 100);

  return { x, P };
}

/**
 * Predict the next state (constant-velocity model, dt = 1 frame).
 * Modifies state in-place.
 */
export function kalmanPredict(
  state: KalmanState,
  config: KalmanConfig = DEFAULT_CONFIG,
): void {
  const { x, P } = state;
  const dt = 1;

  // F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
  const F = _scratch4x4_a;
  F.fill(0);
  F[0] = F[5] = F[10] = F[15] = 1;
  mat4set(F, 0, 2, dt);
  mat4set(F, 1, 3, dt);

  // x' = F * x
  const x0 = x[0],
    x1 = x[1],
    x2 = x[2],
    x3 = x[3];
  x[0] = x0 + dt * x2;
  x[1] = x1 + dt * x3;
  // velocity stays the same

  // P' = F * P * Fᵀ + Q
  const Ft = _scratch4x4_b;
  mat4transpose(F, Ft);

  const FP = _scratch4x4_c;
  mat4mul(F, P, FP);

  // F (_scratch4x4_a) is no longer needed; reuse it for FPFt.
  const FPFt = _scratch4x4_a;
  mat4mul(FP, Ft, FPFt);

  // Q: process noise
  const q = config.sigmaAccel ** 2;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt3 * dt;
  const Q = _scratchQ;
  Q.fill(0);
  mat4set(Q, 0, 0, (dt4 / 4) * q);
  mat4set(Q, 0, 2, (dt3 / 2) * q);
  mat4set(Q, 1, 1, (dt4 / 4) * q);
  mat4set(Q, 1, 3, (dt3 / 2) * q);
  mat4set(Q, 2, 0, (dt3 / 2) * q);
  mat4set(Q, 2, 2, dt2 * q);
  mat4set(Q, 3, 1, (dt3 / 2) * q);
  mat4set(Q, 3, 3, dt2 * q);

  mat4add(FPFt, Q, P);
}

/**
 * Update the state with a measurement [mx, my].
 * Modifies state in-place.
 */
export function kalmanUpdate(
  state: KalmanState,
  mx: number,
  my: number,
  config: KalmanConfig = DEFAULT_CONFIG,
): void {
  const { x, P } = state;
  const r2 = config.sigmaMeas ** 2;

  // Innovation y = z - H * x  (H = [[1,0,0,0],[0,1,0,0]])
  const y0 = mx - x[0];
  const y1 = my - x[1];

  // S = H * P * Hᵀ + R  (2×2)
  const s00 = mat4get(P, 0, 0) + r2;
  const s01 = mat4get(P, 0, 1);
  const s10 = mat4get(P, 1, 0);
  const s11 = mat4get(P, 1, 1) + r2;

  // S⁻¹
  const [si00, si01, si10, si11] = inv2x2(s00, s01, s10, s11);

  // K = P * Hᵀ * S⁻¹  (4×2)
  // P * Hᵀ is columns 0 and 1 of P
  const K = _scratchK;
  for (let i = 0; i < 4; i++) {
    const ph0 = mat4get(P, i, 0);
    const ph1 = mat4get(P, i, 1);
    K[i * 2] = ph0 * si00 + ph1 * si10;
    K[i * 2 + 1] = ph0 * si01 + ph1 * si11;
  }

  // x = x + K * y
  for (let i = 0; i < 4; i++) {
    x[i] += K[i * 2] * y0 + K[i * 2 + 1] * y1;
  }

  // P = (I - K * H) * P
  // KH is 4×4
  const KH = _scratch4x4_a;
  KH.fill(0);
  for (let i = 0; i < 4; i++) {
    mat4set(KH, i, 0, K[i * 2]);
    mat4set(KH, i, 1, K[i * 2 + 1]);
    // columns 2,3 remain 0
  }

  const IminusKH = _scratch4x4_b;
  IminusKH.fill(0);
  IminusKH[0] = IminusKH[5] = IminusKH[10] = IminusKH[15] = 1;
  for (let i = 0; i < 16; i++) IminusKH[i] -= KH[i];

  const newP = _scratch4x4_c;
  mat4mul(IminusKH, P, newP);

  P.set(newP);
}

/**
 * Return the current predicted centroid [x, y].
 */
export function kalmanPosition(state: KalmanState): { x: number; y: number } {
  return { x: state.x[0], y: state.x[1] };
}
