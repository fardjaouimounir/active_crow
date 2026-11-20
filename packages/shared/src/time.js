/**
 * The single injectable clock for the whole code base (API and web): everything that needs "now"
 * or "today" goes through it, so tests control dates with `vi.spyOn(clock, 'now')`.
 */
export const clock = {
  /** @returns {Date} */
  now: () => new Date(),
};

/** @returns {Date} the current instant of the injectable clock */
export function now() {
  return clock.now();
}
