/**
 * Color segmentation for Lumina protocol source detection.
 *
 * Processes video frames at half resolution, producing a binary mask where
 * foreground pixels belong to one of the 5 protocol colors (RED, GREEN,
 * BLUE, WHITE, YELLOW). BLACK and UNKNOWN are background.
 */

import { classifyColor, isProtocolColor } from '../protocol/color.js';
import type { ColorName } from '../protocol/constants.js';

export interface SegmentResult {
  /** Binary mask: 1 = protocol-colored pixel, 0 = background. */
  mask: Uint8Array;
  /** Per-pixel classified color (same length as mask). */
  colors: ColorName[];
  /** Per-pixel original RGB (interleaved, length = mask.length * 3). */
  rgb: Uint8Array;
  /** Dimensions of the mask (half the source frame). */
  width: number;
  height: number;
}

/**
 * Segment a video frame into protocol-colored foreground vs background.
 *
 * Operates at half resolution for performance. Accepts raw RGBA pixel data
 * from `getImageData()`.
 *
 * @param rgba   Raw RGBA pixel data (full resolution).
 * @param srcW   Full-resolution width.
 * @param srcH   Full-resolution height.
 */
export function segmentFrame(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
): SegmentResult {
  // Half resolution
  const width = srcW >> 1;
  const height = srcH >> 1;
  const len = width * height;

  const mask = new Uint8Array(len);
  const colors: ColorName[] = new Array(len);
  const rgb = new Uint8Array(len * 3);

  for (let y = 0; y < height; y++) {
    const srcY = y << 1;
    for (let x = 0; x < width; x++) {
      const srcX = x << 1;
      const idx = y * width + x;

      // Average 2x2 block
      let rSum = 0,
        gSum = 0,
        bSum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const si = ((srcY + dy) * srcW + (srcX + dx)) * 4;
          rSum += rgba[si];
          gSum += rgba[si + 1];
          bSum += rgba[si + 2];
        }
      }

      const r = (rSum >> 2) & 0xff;
      const g = (gSum >> 2) & 0xff;
      const b = (bSum >> 2) & 0xff;

      rgb[idx * 3] = r;
      rgb[idx * 3 + 1] = g;
      rgb[idx * 3 + 2] = b;

      const color = classifyColor(r, g, b);
      colors[idx] = color;
      mask[idx] = isProtocolColor(color) ? 1 : 0;
    }
  }

  return { mask, colors, rgb, width, height };
}
