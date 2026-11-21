// Black-box contract check of the REAL server process, from the point of view of a backend.
//   npm run contract:check          (needs .env with a valid LLM_API_KEY; makes 2 real model calls)
//
// It starts `src/server.js` on a free test port with THROWAWAY service keys, and a fake FieldFlow
// receiver standing in for the backend's internal route. No real service key is read or printed.
// If this passes, the AI side honours the contract; if your backend still fails, the problem is the
// wiring (URL, keys, route, body validation), not the AI service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.CONTRACT_PORT || 4111);
const CB = Number(process.env.CONTRACT_CALLBACK_PORT || 3199);
const IN = 'contract-check-inbound-key';
const OUT = 'contract-check-outbound-key';
const base = `http://127.0.0.1:${PORT}`;
const happy = JSON.parse(fs.readFileSync(path.join(REPO, 'fixtures/supervisor_daily_summary/happy.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const received = [];
let plan = () => 200;
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    const n = received.filter((x) => x.body.requestId === body.requestId).length + 1;
    received.push({ url: req.url, auth: req.headers.authorization, body });
    const status = plan(n);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status < 300 ? '{"ok":true}' : '{"error":"x"}');
  });
});
await new Promise((r) => mock.listen(CB, '127.0.0.1', r));

const child = spawn(process.execPath, ['--env-file=.env', 'src/server.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), AI_SERVICE_INBOUND_KEY: IN, AI_SERVICE_OUTBOUND_KEY: OUT, FIELDFLOW_API_BASE_URL: `http://127.0.0.1:${CB}`, LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const post = (route, body, key = IN) => fetch(base + route, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body),
});
const req = (id, over = {}) => ({ ...structuredClone(happy), requestId: id, ...over });
const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(150); } return pred(); };

try {
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) { try { up = (await fetch(`${base}/health`)).ok; } catch { await sleep(250); } }
  if (!up) throw new Error(`the server did not start. Is .env present with LLM_API_KEY? Server output: ${serverLog.slice(-400)}`);

  const h = await fetch(`${base}/health`);
  check('GET /health is public and returns {ok:true}', h.status === 200 && (await h.json()).ok === true);

  check('no key -> 401', (await post('/v1/supervisor_daily_summary', req(crypto.randomUUID()), null)).status === 401);
  check('wrong key -> 401', (await post('/v1/supervisor_daily_summary', req(crypto.randomUUID()), 'nope')).status === 401);
  const bad = await post('/v1/supervisor_daily_summary', { requestId: 'not-a-uuid' });
  const badBody = await bad.json();
  check('invalid body -> 400 VALIDATION_ERROR with details', bad.status === 400 && badBody.error?.code === 'VALIDATION_ERROR' && Boolean(badBody.error.details));
  const wrongSubject = await post('/v1/supervisor_daily_summary', req(crypto.randomUUID(), { subject: { type: 'campaign', id: 'c1' } }));
  check('wrong subject.type -> 400 INVALID_SUBJECT', wrongSubject.status === 400 && (await wrongSubject.json()).error?.code === 'INVALID_SUBJECT');
  const unknown = await post('/v1/not_a_capability', req(crypto.randomUUID()));
  check('unknown capability -> 400 UNKNOWN_CAPABILITY', unknown.status === 400 && (await unknown.json()).error?.code === 'UNKNOWN_CAPABILITY');
  const pii = req(crypto.randomUUID());
  pii.input.context.data.contact = 'someone@example.com';
  const piiRes = await post('/v1/supervisor_daily_summary', pii);
  check('personal data -> 400 PII_FIREWALL (nothing queued)', piiRes.status === 400 && (await piiRes.json()).error?.code === 'PII_FIREWALL');
  const extra = req(crypto.randomUUID());
  extra.unexpected = 1;
  check('unknown top-level field -> 400 (strict contract)', (await post('/v1/supervisor_daily_summary', extra)).status === 400);

  const emptyReq = req(crypto.randomUUID());
  emptyReq.input.context.data = {};
  check('empty data is accepted (202)', (await post('/v1/supervisor_daily_summary', emptyReq)).status === 202);
  await waitFor(() => received.length >= 1, 5000);
  const e0 = received[0];
  check('NEEDS_DATA callback: confidence 0, modelVersion none@no-data, output.error.code',
    Boolean(e0) && e0.body.confidence === 0 && e0.body.modelVersion === 'none@no-data' && e0.body.output?.error?.code === 'NEEDS_DATA');

  received.length = 0;
  plan = (n) => (n === 1 ? 503 : 200);
  const id = crypto.randomUUID();
  const t0 = Date.now();
  const r1 = await post('/v1/supervisor_daily_summary', req(id));
  const r1b = await r1.json();
  check('valid request -> 202 queued', r1.status === 202 && r1b.data?.status === 'queued' && r1b.data.requestId === id);
  const got2 = await waitFor(() => received.filter((x) => x.body.requestId === id).length >= 2, 90000);
  const mine = received.filter((x) => x.body.requestId === id);
  check('callback retried after a 503 (2 deliveries, same body)', got2 && mine.length === 2 && JSON.stringify(mine[0].body) === JSON.stringify(mine[1].body), `after ${Math.round((Date.now() - t0) / 1000)}s`);
  const cb = mine[0];
  check('callback path and service key are correct', cb?.url === '/api/v1/internal/ai/results' && cb.auth === `Bearer ${OUT}`);
  check('callback body has exactly the 5 contract keys', Boolean(cb) && JSON.stringify(Object.keys(cb.body).sort()) === JSON.stringify(['capability', 'confidence', 'modelVersion', 'output', 'requestId']));
  const o = cb?.body.output;
  check('output is a well-formed supervisor report', Boolean(o) && o.locale === 'en' && typeof o.headline === 'string' && Array.isArray(o.summary) && o.summary.length >= 3 && o.summary.length <= 5 && o.kpis?.attendanceRate === 0.84);
  console.log(`      modelVersion=${cb?.body.modelVersion} confidence=${cb?.body.confidence} fallback=${JSON.stringify(o?.fallback ?? null)}`);
  const dup = await post('/v1/supervisor_daily_summary', req(id));
  check('same requestId again -> 202 cached', dup.status === 202 && (await dup.json()).data?.status === 'cached');
  const before = received.length;
  await sleep(2500);
  check('a duplicate request does not produce another callback', received.length === before);

  received.length = 0;
  plan = () => 422;
  const id2 = crypto.randomUUID();
  await post('/v1/supervisor_daily_summary', req(id2));
  await waitFor(() => received.filter((x) => x.body.requestId === id2).length >= 1, 90000);
  await sleep(3500);
  check('backend answers 422 -> delivered once, not retried', received.filter((x) => x.body.requestId === id2).length === 1);
} catch (e) {
  fail += 1;
  console.log('FAIL  unexpected error:', e.message);
} finally {
  child.kill();
  mock.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
