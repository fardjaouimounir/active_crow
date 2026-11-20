import { ERROR_CODES } from '@fieldflow/shared';
import { AppError, NotFoundError } from '../../core/errors/index.js';

export const problem = (code, status, message, details) =>
  new AppError({ code: ERROR_CODES[code], status, message, details });
export function required(value) {
  if (!value) throw new NotFoundError();
  return value;
}
export function normalizePhone(value) {
  if (!value) return undefined;
  const input = value.replace(/[\s-]/g, '');
  const match = /^(?:0|\+213|00213)([567][0-9]{8})$/.exec(input);
  if (!match) throw problem('INVALID_PHONE', 422, 'Enter an Algerian mobile number');
  return '+213' + match[1];
}
export function maskedCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName:
      row.fullName
        ?.split(/\s+/u)
        .map((part) => Array.from(part)[0] + '.')
        .join(' ') ?? null,
    phone: row.phone ? `+213 ${row.phone[4]}•• •• •• ${row.phone.slice(-2)}` : null,
  };
}
