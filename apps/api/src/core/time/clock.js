import { clock, today } from '@fieldflow/shared';

/**
 * The single source of "now" for application code (token expiry, revocation timestamps…), so tests
 * can control time with `vi.spyOn(clock, 'now')` without faking the event loop. It is the same
 * object as the shared clock, so shared code (policies, evaluation) follows the same time.
 */
export { clock };

/**
 * Business date (YYYY-MM-DD in Africa/Algiers) of an instant, by default now.
 * @param {Date} [instant]
 */
export function businessDate(instant = clock.now()) {
  return today(instant);
}
