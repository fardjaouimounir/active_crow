import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import {
  JSON_BODY_LIMIT,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from './config/constants.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler, RateLimitError } from './core/errors/index.js';
import { requestId } from './core/http/index.js';
import { pingDatabase } from './db/client.js';
import { openApiDocument } from './openapi.js';
import { openApiViewer } from './core/http/openapiViewer.js';
import { createRoutes } from './routes.js';

/**
 * Builds the Express application without binding a port (used by server.js and by tests).
 * @param {{ checkDatabase?: () => Promise<boolean> }} [options]
 */
export function createApp({ checkDatabase = () => pingDatabase() } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  // Assign the request id first so every log line and error response carries it.
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new RateLimitError()),
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  if (env.NODE_ENV === 'development') {
    const spec = openApiDocument();
    app.get('/api/docs', (_req, res) => res.type('html').send(openApiViewer(spec)));
    app.get('/api/docs/openapi.json', (_req, res) => res.json(spec));
  }

  app.use(createRoutes({ checkDatabase }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
