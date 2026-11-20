// The AI service callback. Mounted by app.js BEFORE the global JSON parser and outside the
// user-JWT middleware: it authenticates with the shared outbound service key only.
import { createHash, timingSafeEqual } from 'node:crypto';
import { ERROR_CODES } from '@fieldflow/shared';
import express, { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { GUARD, tagGuard } from '../../core/authz/routeGuards.js';
import { AppError, RateLimitError, UnauthenticatedError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import { aiConfig } from './ai.config.js';
import * as controller from './ai.controller.js';
import * as input from './ai.validators.js';

export const INTERNAL_BODY_LIMIT = '256kb';
export const INTERNAL_RATE_LIMIT_PER_MINUTE = 60;

const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
const BEARER = /^Bearer (\S+)$/;

/** Constant-time comparison of the presented key with the configured one (hashed to equal length). */
export function keyMatches(presented, expected) {
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Route guard: the AI service outbound key, never a user session. */
export const serviceAuth = tagGuard((req, _res, next) => {
  if (!aiConfig.enabled())
    return next(
      new AppError({
        status: 503,
        code: ERROR_CODES.AI_DISABLED,
        message: 'The AI service is not configured',
      }),
    );
  const presented = req.get('authorization')?.match(BEARER)?.[1];
  const ok = presented !== undefined && keyMatches(presented, aiConfig.get().outboundKey);
  next(ok ? undefined : new UnauthenticatedError());
}, GUARD.SERVICE);

export function createInternalAiRouter() {
  const router = Router();
  router.post(
    '/results',
    rateLimit({
      windowMs: 60_000,
      limit: INTERNAL_RATE_LIMIT_PER_MINUTE,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new RateLimitError()),
    }),
    serviceAuth,
    express.json({ limit: INTERNAL_BODY_LIMIT }),
    validate({ body: input.aiCallbackSchema, params: input.empty, query: input.empty }),
    controller.receiveResult,
  );
  return router;
}
