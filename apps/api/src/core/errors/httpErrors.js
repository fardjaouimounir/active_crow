import {
  BUSINESS_RULE_VIOLATION,
  CONFLICT,
  FORBIDDEN,
  NOT_FOUND,
  RATE_LIMITED,
  UNAUTHENTICATED,
  VALIDATION_FAILED,
} from '@fieldflow/shared';
import { AppError } from './AppError.js';

export class ValidationError extends AppError {
  /** @param {Array<{ path: string, message: string }>} details */
  constructor(details, message = 'Request validation failed') {
    super({ status: 400, code: VALIDATION_FAILED, message, details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super({ status: 401, code: UNAUTHENTICATED, message });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to perform this action') {
    super({ status: 403, code: FORBIDDEN, message });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super({ status: 404, code: NOT_FOUND, message });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource was changed or conflicts with another one', details) {
    super({ status: 409, code: CONFLICT, message, details });
  }
}

export class BusinessRuleError extends AppError {
  /**
   * @param {string} message
   * @param {unknown} [details] e.g. `{ rule: 'BR-41' }`
   */
  constructor(message, details) {
    super({ status: 422, code: BUSINESS_RULE_VIOLATION, message, details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super({ status: 429, code: RATE_LIMITED, message });
  }
}
