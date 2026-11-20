import {
  BUSINESS_RULE_VIOLATION,
  CONFLICT,
  CURRENT_PASSWORD_INCORRECT,
  FORBIDDEN,
  INVALID_CREDENTIALS,
  NOT_FOUND,
  PASSWORD_CHANGE_REQUIRED,
  RATE_LIMITED,
  REFRESH_TOKEN_REUSED,
  SESSION_EXPIRED,
  UNAUTHENTICATED,
  VALIDATION_FAILED,
  WEAK_PASSWORD,
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

/** Wrong email, wrong password and inactive accounts all get this same answer. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super({ status: 401, code: INVALID_CREDENTIALS, message: 'Invalid email or password' });
  }
}

/** Access token or refresh cookie missing, expired, revoked or invalid: the client must refresh or log in. */
export class SessionExpiredError extends AppError {
  constructor() {
    super({ status: 401, code: SESSION_EXPIRED, message: 'Your session has expired' });
  }
}

export class RefreshTokenReusedError extends AppError {
  constructor() {
    super({
      status: 401,
      code: REFRESH_TOKEN_REUSED,
      message: 'This session was revoked for security reasons; please sign in again',
    });
  }
}

export class PasswordChangeRequiredError extends AppError {
  constructor() {
    super({
      status: 403,
      code: PASSWORD_CHANGE_REQUIRED,
      message: 'You must change your password before continuing',
    });
  }
}

export class WeakPasswordError extends AppError {
  /** @param {Array<{ path: string, message: string }>} details one entry per broken rule */
  constructor(details) {
    super({
      status: 400,
      code: WEAK_PASSWORD,
      message: 'The new password does not meet the password policy',
      details,
    });
  }
}

export class CurrentPasswordIncorrectError extends AppError {
  constructor() {
    super({
      status: 400,
      code: CURRENT_PASSWORD_INCORRECT,
      message: 'The current password is incorrect',
    });
  }
}
