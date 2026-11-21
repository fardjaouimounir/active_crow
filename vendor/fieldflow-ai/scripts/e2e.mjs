// Full local E2E: real Qwen via the HTTP service -> mock callback receiver.
// Run with: npm run e2e   (needs .env containing a valid LLM_API_KEY)
// No keys are printed.
import http from 'node:http';
import fs from 'node:fs';

const callbackPort = Number(process.env.MOCK_CALLBACK_PORT || 3100);
// This must be set before config.js is imported, because the callback URL is
// computed at module load time.
process.env.FIELDFLOW_API_BASE_URL = `http://127.0.0.1:${callbackPort}`;

const { createApp } = await import(new URL('../src/server.js', import.meta.url).href);
const { config } = await import(new URL('../src/config.js', import.meta.url).href);

const received = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => mock.listen(callbackPort, '127.0.0.1', r));

const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const fixture = JSON.parse(
  fs.readFileSync(new URL('../fixtures/supervisor_daily_summary/happy.json', import.meta.url), 'utf8'),
);

let failed = false;
try {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  console.log('GET /health:', health.status, JSON.stringify(await health.json()));

  const res = await fetch(`http://127.0.0.1:${port}/v1/supervisor_daily_summary`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.AI_SERVICE_INBOUND_KEY}`,
    },
    body: JSON.stringify(fixture),
  });
  console.log('POST /v1/supervisor_daily_summary:', res.status, JSON.stringify(await res.json()));

  const deadline = Date.now() + 30000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (received.length === 0) throw new Error('no callback received within 30s');

  const cb = received[0];
  const out = cb.body.output ?? {};
  const ok = cb.url === '/api/v1/internal/ai/results'
    && Boolean(cb.auth)
    && cb.body.requestId === fixture.requestId
    && cb.body.capability === 'supervisor_daily_summary'
    && typeof cb.body.confidence === 'number'
    && Boolean(out.kpis);
  console.log('Callback:', cb.url, '| auth present:', Boolean(cb.auth));
  console.log('modelVersion:', cb.body.modelVersion, '| confidence:', cb.body.confidence);
  console.log('headline:', String(out.headline ?? '').slice(0, 140));
  console.log('kpis:', JSON.stringify(out.kpis ?? {}));
  console.log(ok ? 'E2E PASS' : 'E2E FAIL');
  failed = !ok;
} catch (error) {
  console.log('E2E ERROR:', error.message);
  failed = true;
} finally {
  server.close();
  mock.close();
}
if (failed) process.exitCode = 1;
