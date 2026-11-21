import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm, PRIMARY_MODEL } from '../src/pipeline/llm.js';
import { createCallback } from '../src/pipeline/callback.js';
import { getCapability } from '../src/capabilities/index.js';

const CAPS = ['supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching'];
const load = (cap, name = 'happy.json') =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${cap}/${name}`, import.meta.url), 'utf8'));

function harness(capability, opts = {}) {
  const calls = [];
  const delivered = [];
  const cap = getCapability(capability);
  const body = opts.body ?? load(capability);

  const llm = createLlm({
    callModel: async ({ model }) => {
      calls.push(model);
      if (opts.throwOn?.includes(model)) throw new Error('provider down');
      if (opts.malformed) return 'definitely not json';
      const data = body.input.context.data ?? {};
      const kpis = cap.computeKpis(data);
      const ranking = cap.computeRanking ? cap.computeRanking(data) : [];
      return JSON.stringify(cap.fallback(body.input.context.locale, kpis, ranking));
    },
  });

  const callback = createCallback({
    key: 'test-outbound',
    fetchImpl: async (_url, init) => {
      delivered.push({ authorization: init.headers.authorization, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
    sleep: async () => {},
  });

  const pipeline = createPipeline({ llm, callback, outputMode: 'legacy' });
  const app = createApp({ pipeline, inboundKey: 'test-inbound' });
  return { app, pipeline, calls, delivered, body };
}

async function post(h, capability, body = h.body) {
  return request(h.app)
    .post(`/v1/${capability}`)
    .set('authorization', 'Bearer test-inbound')
    .send(body);
}

describe('HTTP contract', () => {
  it('accepts all four capabilities and delivers one callback each', async () => {
    for (const capability of CAPS) {
      const h = harness(capability);
      const res = await post(h, capability);
      expect(res.status, capability).toBe(202);
      expect(res.body.data.status).toBe('queued');
      await h.pipeline.waitFor(h.body.requestId);
      expect(h.delivered, capability).toHaveLength(1);
      expect(h.delivered[0].body.capability).toBe(capability);
      expect(h.delivered[0].body.requestId).toBe(h.body.requestId);
      expect(h.delivered[0].authorization).toBe('Bearer test-outbound');
    }
  });

  it('returns 400 for an unknown capability and for an unknown field', async () => {
    const h = harness('supervisor_daily_summary');
    expect((await request(h.app).post('/v1/nope').set('authorization', 'Bearer test-inbound').send({})).status).toBe(400);
    expect((await post(h, 'supervisor_daily_summary', { ...h.body, surprise: 1 })).status).toBe(400);
  });

  it('returns 401 without the inbound service key', async () => {
    const h = harness('supervisor_daily_summary');
    const res = await request(h.app).post('/v1/supervisor_daily_summary').send(h.body);
    expect(res.status).toBe(401);
  });

  it('serves an unauthenticated /health check for container orchestration', async () => {
    const h = harness('supervisor_daily_summary');
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('treats a duplicate requestId as a no-op', async () => {
    const h = harness('supervisor_daily_summary');
    const first = await post(h, 'supervisor_daily_summary');
    await h.pipeline.waitFor(h.body.requestId);
    const second = await post(h, 'supervisor_daily_summary');
    expect(first.body.data.status).toBe('queued');
    expect(second.body.data.status).toBe('cached');
    expect(h.calls).toHaveLength(1);
    expect(h.delivered).toHaveLength(1);
  });
});

describe('model routing and fallback', () => {
  it('uses the deterministic template when the provider call throws', async () => {
    const h = harness('supervisor_daily_summary', { throwOn: [PRIMARY_MODEL] });
    await post(h, 'supervisor_daily_summary');
    const result = await h.pipeline.waitFor(h.body.requestId);
    expect(h.calls).toEqual([PRIMARY_MODEL]);
    expect(result.modelVersion).toContain('deterministic-fallback');
    expect(result.delivery.ok).toBe(true);
  });

  it('uses a deterministic templated report after an invalid output', async () => {
    const h = harness('sales_performance', { malformed: true });
    await post(h, 'sales_performance');
    const result = await h.pipeline.waitFor(h.body.requestId);
    // first call + exactly ONE repair retry, then the deterministic template
    expect(h.calls).toHaveLength(2);
    expect(result.modelVersion).toContain('deterministic-fallback');
    expect(result.confidence).toBe(0);
    expect(result.output.fallback).toMatchObject({ used: true, reasonCode: 'MODEL_JSON_PARSE_FAILED' });
    expect(result.output.trends[0]).toContain('200');
  });

  it('sends NEEDS_DATA with confidence 0 when no aggregate data is supplied', async () => {
    const h = harness('supervisor_daily_summary', {
      body: load('supervisor_daily_summary', 'empty.json'),
    });
    await post(h, 'supervisor_daily_summary', h.body);
    const result = await h.pipeline.waitFor(h.body.requestId);
    expect(h.calls).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.output.error.code).toBe('NEEDS_DATA');
  });
});

describe('callback delivery', () => {
  it('retries three times with backoff then reports failure', async () => {
    const attempts = [];
    const sleeps = [];
    const cb = createCallback({
      key: 'k',
      fetchImpl: async () => { attempts.push(Date.now()); return { ok: false, status: 500 }; },
      backoffMs: [10, 20, 40],
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const result = await cb.post({ requestId: 'x' });
    expect(attempts).toHaveLength(4);
    expect(sleeps).toEqual([10, 20, 40]);
    expect(result.ok).toBe(false);
  });

  it('does not retry a permanent 422 (unknown requestId or capability mismatch)', async () => {
    let attempts = 0;
    const cb = createCallback({
      key: 'k',
      fetchImpl: async () => { attempts += 1; return { ok: false, status: 422 }; },
      backoffMs: [10, 20, 40],
      sleep: async () => {},
    });
    const result = await cb.post({ requestId: 'x' });
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });
});
