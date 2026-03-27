/**
 * Source candidate extraction from connected components.
 *
 * Applies the segmentation → CCL → merge pipeline to a video frame and
 * returns a list of detected optical source candidates with their
 * bounding boxes, centroids, and classified protocol colors.
 */

import type { ColorName } from '../protocol/constants.js';
import type { BBox } from './components.js';
import { segmentFrame } from './segment.js';
import { extractComponents, mergeOverlapping } from './components.js';

export interface SourceCandidate {
  bbox: BBox;
  /** Centroid in half-resolution coordinates. */
  centroid: { x: number; y: number };
  area: number;
  meanColor: { r: number; g: number; b: number };
  classifiedColor: ColorName;
}

/**
 * Detect source candidates in a single video frame.
 *
 * @param rgba     Raw RGBA pixel data from `getImageData()`.
 * @param srcW     Full-resolution width.
 * @param srcH     Full-resolution height.
 * @param minArea  Minimum blob area in half-res pixels (default: 0.1% of half-res frame).
 */
export function detectCandidates(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  minArea?: number,
): SourceCandidate[] {
  const seg = segmentFrame(rgba, srcW, srcH);

  const defaultMinArea = Math.max(20, Math.floor(seg.width * seg.height * 0.001));
  const rawComponents = extractComponents(
    seg.mask,
    seg.rgb,
    seg.width,
    seg.height,
    minArea ?? defaultMinArea,
  );

  const merged = mergeOverlapping(rawComponents, 0.5);

  return merged.map((c) => ({
    bbox: c.bbox,
    centroid: c.centroid,
    area: c.area,
    meanColor: { r: c.meanR, g: c.meanG, b: c.meanB },
    classifiedColor: c.classifiedColor,
  }));
}
