import { decodeHamming74, encodeHamming74 } from './hamming.js';
import { calculateChecksum } from './checksum.js';

export interface PacketResult {
  text: string;
  valid: boolean;
  corrections: number;
}

/**
 * Decode a binary string received over the optical channel.
 *
 * The binary data consists of Hamming(7,4)-encoded blocks. After FEC
 * decoding, the last 8 bits are an XOR checksum of the payload text.
 */
export function processPacketData(binaryString: string): PacketResult {
  let decodedBits = '';
  let corrections = 0;

  for (let i = 0; i + 7 <= binaryString.length; i += 7) {
    const block = binaryString.slice(i, i + 7);
    const { nibble, corrected } = decodeHamming74(block);
    decodedBits += nibble;
    if (corrected) corrections++;
  }

  if (decodedBits.length < 16) return { text: '', valid: false, corrections };

  const payloadBits = decodedBits.slice(0, -8);
  const receivedChecksumBits = decodedBits.slice(-8);

  let text = '';
  for (let i = 0; i < payloadBits.length; i += 8) {
    const byte = payloadBits.slice(i, i + 8);
    if (byte.length === 8) {
      text += String.fromCharCode(parseInt(byte, 2));
    }
  }

  const calculatedChecksumBits = calculateChecksum(text);
  const valid = calculatedChecksumBits === receivedChecksumBits;
  return { text, valid, corrections };
}

/**
 * Encode a text message into a FEC-protected binary string ready for
 * optical transmission.
 *
 * Returns the Hamming(7,4)-encoded bitstream including the XOR checksum.
 */
export function encodePacketData(message: string): string {
  let binaryPayload = '';
  for (let i = 0; i < message.length; i++) {
    binaryPayload += message.charCodeAt(i).toString(2).padStart(8, '0');
  }

  const checksumBits = calculateChecksum(message);
  const fullData = binaryPayload + checksumBits;

  let fecEncoded = '';
  for (let i = 0; i < fullData.length; i += 4) {
    const nibble = fullData.slice(i, i + 4).padEnd(4, '0');
    fecEncoded += encodeHamming74(nibble);
  }

  return fecEncoded;
}
