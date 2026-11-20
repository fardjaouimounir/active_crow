import { z } from 'zod';
import { clock } from './time.js';

const businessDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Algiers',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Algerian business date (YYYY-MM-DD) of an instant, by default now on the injectable clock. */
export function today(instant = clock.now()) {
  return businessDateFormat.format(instant);
}

export const algerianPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:0|\+213)\d{9}$/)
  .transform((phone) => (phone.startsWith('0') ? '+213' + phone.slice(1) : phone));
