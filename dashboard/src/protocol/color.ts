import type { ColorName } from './constants.js';

/**
 * Classify an RGB pixel into a protocol color name.
 *
 * Thresholds tuned for screens viewed through a camera — protocol colors are
 * saturated and bright, easily distinguishable from natural backgrounds.
 */
export function classifyColor(r: number, g: number, b: number): ColorName {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  if (r > 200 && g > 200 && b > 200) return 'WHITE';
  if (r < 80 && g < 80 && b < 80) return 'BLACK';
  if (r > 180 && g > 180 && b < 100) return 'YELLOW';

  if (diff > 50) {
    if (max === r && g < 150 && b < 150) return 'RED';
    if (max === g && r < 150 && b < 150) return 'GREEN';
    if (max === b && r < 150 && g < 150) return 'BLUE';
  }

  return 'UNKNOWN';
}

/**
 * Returns true if the color is one of the 5 active protocol colors
 * (i.e. not BLACK and not UNKNOWN).
 */
export function isProtocolColor(color: ColorName): boolean {
  return (
    color === 'RED' ||
    color === 'GREEN' ||
    color === 'BLUE' ||
    color === 'WHITE' ||
    color === 'YELLOW'
  );
}
