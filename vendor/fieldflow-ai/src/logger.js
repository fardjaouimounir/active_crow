import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.apiKey',
      '*.api_key',
      '*.outboundKey',
      '*.inboundKey',
    ],
    remove: true,
  },
});
