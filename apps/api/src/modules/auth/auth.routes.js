import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
  CHANGE_PASSWORD_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
} from '../../config/constants.js';
import { authenticate } from '../../core/auth/index.js';
import { anyAuthenticated, publicRoute } from '../../core/authz/index.js';
import { RateLimitError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './auth.controller.js';
import { changePasswordSchemas, emptyBodySchemas, loginSchemas } from './auth.validators.js';

/** @param {(req: import('express').Request) => string} keyGenerator @param {number} limit */
function attemptLimiter(keyGenerator, limit) {
  return rateLimit({
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError()),
  });
}

/** 5 attempts per minute per client IP + lower-cased email, counted before validation. */
const loginKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
};

/**
 * /api/v1/auth. A factory so each app instance (and each test) gets its own rate-limit counters.
 * Every route is either `publicRoute()` or `authenticate` + a permission guard.
 */
export function createAuthRouter() {
  const router = Router();

  router.post(
    '/login',
    publicRoute(),
    attemptLimiter(loginKey, LOGIN_RATE_LIMIT_MAX_ATTEMPTS),
    validate(loginSchemas),
    controller.login,
  );
  router.post('/refresh', publicRoute(), validate(emptyBodySchemas), controller.refresh);

  router.post(
    '/logout',
    authenticate,
    anyAuthenticated(),
    validate(emptyBodySchemas),
    controller.logout,
  );
  router.post(
    '/logout-all',
    authenticate,
    anyAuthenticated(),
    validate(emptyBodySchemas),
    controller.logoutAll,
  );
  router.post(
    '/change-password',
    authenticate,
    anyAuthenticated(),
    attemptLimiter(
      (req) => ipKeyGenerator(req.ip ?? '') + '|' + req.actor.id,
      CHANGE_PASSWORD_RATE_LIMIT_MAX_ATTEMPTS,
    ),
    validate(changePasswordSchemas),
    controller.changePassword,
  );
  router.get('/me', authenticate, anyAuthenticated(), controller.me);

  return router;
}
