import express from 'express';
import { config, assertSecrets } from './config.js';
import { RequestSchema } from './schemas/request.js';
import { getCapability, prepareReportData } from './capabilities/index.js';
import { createPipeline } from './pipeline/index.js';
import { logger } from './logger.js';

export function createApp({ pipeline = createPipeline(), inboundKey = config.AI_SERVICE_INBOUND_KEY } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ strict: true, limit: '1mb' }));

  // Constant-time comparison to avoid timing side-channels on the credential.
  // Implemented in-process to avoid a top-level `node:crypto` import that vite
  // 7's import-analysis cannot transform in this environment.
  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function requireServiceKey(req, res, next) {
    const header = req.get('authorization') ?? '';
    const expected = `Bearer ${inboundKey}`;
    if (
      header.length !== expected.length ||
      !timingSafeEqual(Buffer.from(header), Buffer.from(expected))
    ) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
    }
    next();
  }

  const routes = [
    ['supervisor_daily_summary', 'post'],
    ['sales_performance', 'post'],
    ['campaign_insights', 'post'],
    ['animateur_coaching', 'post'],
  ];

  for (const [capabilityId] of routes) {
    app.post(`/v1/${capabilityId}`, requireServiceKey, (req, res) => {
      const parsed = RequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
        });
      }
      const request = parsed.data;
      const cap = getCapability(capabilityId);
      if (!cap.subjects.includes(request.subject.type)) {
        return res.status(400).json({
          error: { code: 'INVALID_SUBJECT', message: `${capabilityId} requires subject.type in ${cap.subjects.join('|')}` },
        });
      }
      // PII firewall at the ingress boundary: reject personal/file data before
      // any job is enqueued or any model call is made.
      try {
        prepareReportData(capabilityId, request.input.context.data ?? {});
      } catch (error) {
        if (error.code === 'PII_FIREWALL') {
          return res.status(400).json({
            error: { code: 'PII_FIREWALL', message: error.message },
          });
        }
        throw error;
      }
      const { duplicate } = pipeline.enqueue(request, capabilityId);
      return res.status(202).json({
        data: { requestId: request.requestId, status: duplicate ? 'cached' : 'queued' },
      });
    });
  }

  // A fifth/unknown capability is a 400, not a 404.
  app.all('/v1/:capability', requireServiceKey, (req, res) => {
    res.status(400).json({ error: { code: 'UNKNOWN_CAPABILITY', capability: req.params.capability } });
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use((error, _req, res, _next) => {
    logger.error({ err: error }, 'request failed');
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: { code: 'INVALID_JSON' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  });

  return app;
}

// Works on Windows and Linux (the old check built "file:////app/..." on Linux, so
// the server never started inside the container).
function isMainModule() {
  if (!process.argv[1]) return false;
  const self = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const entry = process.argv[1].replace(/\\/g, '/');
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}
const isMain = isMainModule();
if (isMain) {
  assertSecrets();
  const app = createApp();
  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'fieldflow-ai listening');
  });
}
