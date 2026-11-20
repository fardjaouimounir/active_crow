import { INTERNAL_ERROR } from '@fieldflow/shared';

/**
 * Base class for every error that is safe to show to the client.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  /**
   * @param {object} options
   * @param {number} [options.status]
   * @param {string} [options.code] UPPER_SNAKE code from @fieldflow/shared
   * @param {string} options.message client-safe message
   * @param {unknown} [options.details]
   * @param {unknown} [options.cause]
   */
  constructor({ status = 500, code = INTERNAL_ERROR, message, details, cause }) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
