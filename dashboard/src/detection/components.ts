/**
 * Connected-component labeling using a two-pass union-find algorithm.
 *
 * Extracts blobs from a binary mask, computing bounding box, centroid,
 * area, and mean color for each component.
 */

import type { ColorName } from '../protocol/constants.js';
import { classifyColor } from '../protocol/color.js';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Component {
  label: number;
  bbox: BBox;
  centroid: { x: number; y: number };
  area: number;
  meanR: number;
  meanG: number;
  meanB: number;
  classifiedColor: ColorName;
}

// ── Union-Find ──────────────────────────────────────────────────────────

class UnionFind {
  parent: Int32Array;
  rank: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path compression
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ── Two-pass CCL ────────────────────────────────────────────────────────

/**
 * Extract connected components from a binary mask.
 *
 * @param mask    Binary mask (1 = foreground, 0 = background).
 * @param rgb     Interleaved RGB values (length = mask.length * 3).
 * @param width   Mask width.
 * @param height  Mask height.
 * @param minArea Minimum pixel count to keep a component (default 20).
 * @param maxAreaFraction Maximum fraction of total pixels (default 0.4).
 */
export function extractComponents(
  mask: Uint8Array,
  rgb: Uint8Array,
  width: number,
  height: number,
  minArea = 20,
  maxAreaFraction = 0.4,
): Component[] {
  const totalPixels = width * height;
  const labels = new Int32Array(totalPixels);
  labels.fill(-1);

  const uf = new UnionFind(totalPixels);
  let nextLabel = 0;

  // Pass 1: assign provisional labels + union neighbors
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      const neighbors: number[] = [];
      // Left
      if (x > 0 && mask[idx - 1] === 1) {
        neighbors.push(labels[idx - 1]);
      }
      // Up
      if (y > 0 && mask[idx - width] === 1) {
        neighbors.push(labels[idx - width]);
      }

      if (neighbors.length === 0) {
        labels[idx] = nextLabel++;
      } else {
        const minLabel = Math.min(...neighbors);
        labels[idx] = minLabel;
        for (const n of neighbors) {
          uf.union(minLabel, n);
        }
      }
    }
  }

  // Pass 2: resolve labels + accumulate stats
  const statsMap = new Map<
    number,
    {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      sumX: number;
      sumY: number;
      sumR: number;
      sumG: number;
      sumB: number;
      area: number;
    }
  >();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] < 0) continue;

      const root = uf.find(labels[idx]);
      labels[idx] = root;

      let stats = statsMap.get(root);
      if (!stats) {
        stats = {
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
          sumX: 0,
          sumY: 0,
          sumR: 0,
          sumG: 0,
          sumB: 0,
          area: 0,
        };
        statsMap.set(root, stats);
      }

      stats.minX = Math.min(stats.minX, x);
      stats.minY = Math.min(stats.minY, y);
      stats.maxX = Math.max(stats.maxX, x);
      stats.maxY = Math.max(stats.maxY, y);
      stats.sumX += x;
      stats.sumY += y;
      stats.sumR += rgb[idx * 3];
      stats.sumG += rgb[idx * 3 + 1];
      stats.sumB += rgb[idx * 3 + 2];
      stats.area++;
    }
  }

  // Build component list, filtering by area
  const maxArea = totalPixels * maxAreaFraction;
  const components: Component[] = [];

  for (const [label, s] of statsMap) {
    if (s.area < minArea || s.area > maxArea) continue;

    const meanR = Math.round(s.sumR / s.area);
    const meanG = Math.round(s.sumG / s.area);
    const meanB = Math.round(s.sumB / s.area);

    components.push({
      label,
      bbox: {
        x: s.minX,
        y: s.minY,
        w: s.maxX - s.minX + 1,
        h: s.maxY - s.minY + 1,
      },
      centroid: {
        x: s.sumX / s.area,
        y: s.sumY / s.area,
      },
      area: s.area,
      meanR,
      meanG,
      meanB,
      classifiedColor: classifyColor(meanR, meanG, meanB),
    });
  }

  return components;
}

/**
 * Merge overlapping components (IoU > threshold) into a single component.
 */
export function mergeOverlapping(
  components: Component[],
  iouThreshold = 0.5,
): Component[] {
  if (components.length <= 1) return components;

  const merged = new Array<boolean>(components.length).fill(false);
  const result: Component[] = [];

  for (let i = 0; i < components.length; i++) {
    if (merged[i]) continue;

    let current = { ...components[i] };
    let didMerge = true;

    while (didMerge) {
      didMerge = false;
      for (let j = i + 1; j < components.length; j++) {
        if (merged[j]) continue;
        if (computeIoU(current.bbox, components[j].bbox) > iouThreshold) {
          current = mergeTwo(current, components[j]);
          merged[j] = true;
          didMerge = true;
        }
      }
    }

    result.push(current);
  }

  return result;
}

function computeIoU(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - inter;

  return union > 0 ? inter / union : 0;
}

function mergeTwo(a: Component, b: Component): Component {
  const totalArea = a.area + b.area;
  const minX = Math.min(a.bbox.x, b.bbox.x);
  const minY = Math.min(a.bbox.y, b.bbox.y);
  const maxX = Math.max(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w);
  const maxY = Math.max(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h);

  const meanR = Math.round((a.meanR * a.area + b.meanR * b.area) / totalArea);
  const meanG = Math.round((a.meanG * a.area + b.meanG * b.area) / totalArea);
  const meanB = Math.round((a.meanB * a.area + b.meanB * b.area) / totalArea);

  return {
    label: a.label,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    centroid: {
      x: (a.centroid.x * a.area + b.centroid.x * b.area) / totalArea,
      y: (a.centroid.y * a.area + b.centroid.y * b.area) / totalArea,
    },
    area: totalArea,
    meanR,
    meanG,
    meanB,
    classifiedColor: classifyColor(meanR, meanG, meanB),
  };
}
