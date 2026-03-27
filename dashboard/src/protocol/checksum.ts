/** Compute a simple XOR checksum of a string, returned as an 8-bit binary string. */
export function calculateChecksum(text: string): string {
  let checksum = 0;
  for (let i = 0; i < text.length; i++) {
    checksum ^= text.charCodeAt(i);
  }
  return checksum.toString(2).padStart(8, '0');
}
