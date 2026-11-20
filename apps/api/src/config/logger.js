import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.phone'],
    censor: '[REDACTED]',
  },
  // Structured JSON everywhere except local development, where it is pretty-printed.
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } },
  }),
});
