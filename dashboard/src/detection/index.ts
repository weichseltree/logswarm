/**
 * Detection pipeline orchestrator.
 *
 * Runs the full pipeline per frame:
 *   segmentation → CCL → candidate extraction → Kalman predict →
 *   Hungarian assignment → Kalman update → source state management
 *
 * Each tracked source has a persistent ID, a Kalman filter for position
 * tracking, and a protocol state machine for demodulating the optical
 * data stream.
 */

import type { ColorName } from '../protocol/constants.js';
import { PROTOCOL } from '../protocol/constants.js';
import { processPacketData, type PacketResult } from '../protocol/packet.js';
import type { BBox } from './components.js';
import type { SourceCandidate } from './candidates.js';
import { detectCandidates } from './candidates.js';
import {
  createKalman,
  kalmanPredict,
  kalmanUpdate,
  kalmanPosition,
  type KalmanState,
  type KalmanConfig,
} from './tracker.js';
import { hungarian } from './assign.js';

export type { BBox } from './components.js';
export type { SourceCandidate } from './candidates.js';
export { kalmanPosition } from './tracker.js';

// ── Protocol state machine per source ───────────────────────────────

export interface ProtocolState {
  bits: string;
  waitingForData: boolean;
  lastColor: ColorName;
  isReceivingPacket: boolean;
  lastDecoded: string;
  corrections: number;
  lastValid: boolean;
  lastUpdate: number;
}

function createProtocolState(): ProtocolState {
  return {
    bits: '',
    waitingForData: false,
    lastColor: 'UNKNOWN',
    isReceivingPacket: false,
    lastDecoded: '',
    corrections: 0,
    lastValid: false,
    lastUpdate: 0,
  };
}

/**
 * Feed a classified color into the protocol state machine.
 * Returns a PacketResult if a complete packet was decoded, null otherwise.
 */
function feedColor(
  state: ProtocolState,
  color: ColorName,
): PacketResult | null {
  if (color === state.lastColor) return null;

  state.lastColor = color;

  if (color === PROTOCOL.START) {
    state.bits = '';
    state.waitingForData = false;
    state.isReceivingPacket = true;
    state.lastUpdate = Date.now();
    return null;
  }

  if (!state.isReceivingPacket) return null;

  if (color === PROTOCOL.CLOCK) {
    state.waitingForData = true;
    state.lastUpdate = Date.now();
    return null;
  }

  if (color === PROTOCOL.BIT_0 && state.waitingForData) {
    state.bits += '0';
    state.waitingForData = false;
    state.lastUpdate = Date.now();
    return null;
  }

  if (color === PROTOCOL.BIT_1 && state.waitingForData) {
    state.bits += '1';
    state.waitingForData = false;
    state.lastUpdate = Date.now();
    return null;
  }

  if (color === PROTOCOL.END) {
    state.isReceivingPacket = false;
    state.waitingForData = false;

    if (state.bits.length > 0) {
      const result = processPacketData(state.bits);
      state.lastDecoded = result.text;
      state.corrections = result.corrections;
      state.lastValid = result.valid;
      state.lastUpdate = Date.now();
      return result;
    }
  }

  return null;
}

// ── Tracked source ──────────────────────────────────────────────────

export interface TrackedSource {
  id: string;
  kalman: KalmanState;
  /** Bounding box in half-resolution coordinates. */
  bbox: BBox;
  protocol: ProtocolState;
  missedFrames: number;
  confidence: number;
  /** Age in frames since first detection. */
  age: number;
}

// ── Pipeline ────────────────────────────────────────────────────────

export interface DetectionEvent {
  sourceId: string;
  result: PacketResult;
}

export interface PipelineConfig {
  /** Max Euclidean distance (half-res px) to match a detection to a track. */
  gateDistance: number;
  /** Frames without a match before a track is removed. */
  maxMissedFrames: number;
  /** Kalman filter tuning. */
  kalman: KalmanConfig;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  gateDistance: 150,
  maxMissedFrames: 30,
  kalman: { sigmaAccel: 2.0, sigmaMeas: 8.0 },
};

export class DetectionPipeline {
  private tracks: Map<string, TrackedSource> = new Map();
  private nextId = 0;
  private config: PipelineConfig;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }

  /**
   * Process a single video frame.
   *
   * @param rgba  Raw RGBA pixel data (full resolution).
   * @param srcW  Full-resolution width.
   * @param srcH  Full-resolution height.
   * @returns Events from any completed packet decodings this frame.
   */
  processFrame(
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
  ): DetectionEvent[] {
    const events: DetectionEvent[] = [];

    // 1. Detect candidates
    const candidates = detectCandidates(rgba, srcW, srcH);

    // 2. Predict all existing tracks
    for (const track of this.tracks.values()) {
      kalmanPredict(track.kalman, this.config.kalman);
    }

    // 3. Build cost matrix: tracks (rows) × detections (cols)
    const trackList = Array.from(this.tracks.values());
    const nTracks = trackList.length;
    const nDets = candidates.length;

    if (nTracks > 0 && nDets > 0) {
      const costMatrix: number[][] = [];
      for (let i = 0; i < nTracks; i++) {
        const predicted = kalmanPosition(trackList[i].kalman);
        const row: number[] = [];
        for (let j = 0; j < nDets; j++) {
          const det = candidates[j];
          const dx = predicted.x - det.centroid.x;
          const dy = predicted.y - det.centroid.y;
          row.push(Math.sqrt(dx * dx + dy * dy));
        }
        costMatrix.push(row);
      }

      // 4. Hungarian assignment
      const assignments = hungarian(costMatrix);

      const matchedTracks = new Set<number>();
      const matchedDets = new Set<number>();

      for (const [trackIdx, detIdx] of assignments) {
        if (costMatrix[trackIdx][detIdx] <= this.config.gateDistance) {
          matchedTracks.add(trackIdx);
          matchedDets.add(detIdx);

          const track = trackList[trackIdx];
          const det = candidates[detIdx];

          // Update Kalman
          kalmanUpdate(
            track.kalman,
            det.centroid.x,
            det.centroid.y,
            this.config.kalman,
          );

          // Update track metadata
          track.bbox = det.bbox;
          track.missedFrames = 0;
          track.confidence = Math.min(1, track.confidence + 0.1);
          track.age++;

          // Feed color to protocol state machine
          const result = feedColor(track.protocol, det.classifiedColor);
          if (result) {
            events.push({ sourceId: track.id, result });
          }
        }
      }

      // 5. Handle unmatched tracks (coast)
      for (let i = 0; i < nTracks; i++) {
        if (!matchedTracks.has(i)) {
          trackList[i].missedFrames++;
          trackList[i].confidence = Math.max(
            0,
            trackList[i].confidence - 0.05,
          );
          trackList[i].age++;
        }
      }

      // 6. Handle unmatched detections (new tracks)
      for (let j = 0; j < nDets; j++) {
        if (!matchedDets.has(j)) {
          this.createTrack(candidates[j]);
        }
      }
    } else if (nDets > 0) {
      // No existing tracks — create all
      for (const det of candidates) {
        this.createTrack(det);
      }
    } else {
      // No detections — coast all tracks
      for (const track of this.tracks.values()) {
        track.missedFrames++;
        track.confidence = Math.max(0, track.confidence - 0.05);
        track.age++;
      }
    }

    // 7. Remove dead tracks
    for (const [id, track] of this.tracks) {
      if (track.missedFrames > this.config.maxMissedFrames) {
        this.tracks.delete(id);
      }
    }

    return events;
  }

  private createTrack(det: SourceCandidate): void {
    const id = `S${this.nextId++}`;
    const track: TrackedSource = {
      id,
      kalman: createKalman(
        det.centroid.x,
        det.centroid.y,
        this.config.kalman,
      ),
      bbox: det.bbox,
      protocol: createProtocolState(),
      missedFrames: 0,
      confidence: 0.3,
      age: 1,
    };

    // Feed the initial detection color
    feedColor(track.protocol, det.classifiedColor);

    this.tracks.set(id, track);
  }

  /** Get all currently active tracked sources (for rendering). */
  getTrackedSources(): TrackedSource[] {
    return Array.from(this.tracks.values());
  }

  /** Get track count. */
  get trackCount(): number {
    return this.tracks.size;
  }

  /** Reset all tracks. */
  reset(): void {
    this.tracks.clear();
    this.nextId = 0;
  }
}
