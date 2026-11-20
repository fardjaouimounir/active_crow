import { BUSINESS_TIME_ZONE } from '../../config/constants.js';

/**
 * The single source of "now" for application code (token expiry, revocation timestamps…), so tests
 * can control time with `vi.spyOn(clock, 'now')` without faking the event loop.
 */
export const clock = {
  /** @returns {Date} */
  now: () => new Date(),
};

const businessDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Business date (YYYY-MM-DD in Africa/Algiers) of an instant, by default now.
 * @param {Date} [instant]
 */
export function businessDate(instant = clock.now()) {
  return businessDateFormat.format(instant);
}
