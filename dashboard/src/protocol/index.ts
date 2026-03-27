export { type ColorName, PROTOCOL, BAUD_RATES, type BaudRate } from './constants.js';
export { classifyColor, isProtocolColor } from './color.js';
export { calculateChecksum } from './checksum.js';
export { encodeHamming74, decodeHamming74 } from './hamming.js';
export { processPacketData, encodePacketData, type PacketResult } from './packet.js';
