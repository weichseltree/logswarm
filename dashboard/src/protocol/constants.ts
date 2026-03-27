/** Protocol color names used in the Lumina Light-Based Protocol. */
export type ColorName =
  | 'RED'
  | 'GREEN'
  | 'BLUE'
  | 'WHITE'
  | 'YELLOW'
  | 'BLACK'
  | 'UNKNOWN';

/** Mapping of protocol signals to their color names. */
export const PROTOCOL = {
  START: 'WHITE' as const,
  CLOCK: 'BLUE' as const,
  BIT_0: 'RED' as const,
  BIT_1: 'GREEN' as const,
  END: 'YELLOW' as const,
};

/** Default baud rates (ms per symbol). */
export const BAUD_RATES = [100, 200, 400] as const;
export type BaudRate = (typeof BAUD_RATES)[number];
