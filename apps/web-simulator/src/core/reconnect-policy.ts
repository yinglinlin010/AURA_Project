export const RECONNECT_INITIAL_DELAY_MS = 250;
export const RECONNECT_MAX_DELAY_MS = 8_000;

/** Delay before retry number `failedAttempts` (zero based). */
export function reconnectDelayMs(failedAttempts: number): number {
  if (!Number.isFinite(failedAttempts) || failedAttempts < 0) throw new RangeError('failedAttempts must be a non-negative finite number');
  const exponent = Math.floor(failedAttempts);
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_INITIAL_DELAY_MS * (2 ** Math.min(exponent, 30)));
}
