import { z } from 'zod';

const businessDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Algiers',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Returns the Algerian business date for the supplied instant. */
export function today(instant = new Date()) {
  return businessDateFormat.format(instant);
}

export const algerianPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:0|\+213)\d{9}$/)
  .transform((phone) => (phone.startsWith('0') ? '+213' + phone.slice(1) : phone));
