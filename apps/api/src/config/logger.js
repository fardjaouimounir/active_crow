import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
      'JWT_ACCESS_SECRET',
      '*.JWT_ACCESS_SECRET',
      '*.phone',
      // Connection strings carry credentials (pg pool config, env dumps).
      'DATABASE_URL',
      'DATABASE_URL_TEST',
      '*.DATABASE_URL',
      '*.DATABASE_URL_TEST',
      '*.connectionString',
    ],
    censor: '[REDACTED]',
  },
  // Structured JSON everywhere except local development, where it is pretty-printed.
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } },
  }),
});
