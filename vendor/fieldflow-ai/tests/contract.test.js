import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { RequestSchema, CallbackSchema, CapabilitySchema } from '../src/schemas/request.js';
import { OutputSchemas } from '../src/schemas/outputs.js';
import { getCapability } from '../src/capabilities/index.js';
import { checkNumbers } from '../src/pipeline/number-check.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CAPS = ['supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching'];
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const EXPECTED_SUBJECT = {
  supervisor_daily_summary: 'supervisor',
  sales_performance: 'campaign',
  campaign_insights: 'campaign',
  animateur_coaching: 'campaign',
};

function allFixtures() {
  const out = [];
  for (const cap of CAPS) {
    const dir = path.join(FIXTURE_DIR, cap);
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      out.push({ cap, name, body: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) });
    }
  }
  return out;
}

describe('request contract', () => {
  it('every one of the 20 fixtures parses strictly', () => {
    const fixtures = allFixtures();
    expect(fixtures).toHaveLength(20);
    for (const { cap, name, body } of fixtures) {
      expect(RequestSchema.safeParse(body).success, `${cap}/${name}`).toBe(true);
      expect(body.subject.type, `${cap}/${name}`).toBe(EXPECTED_SUBJECT[cap]);
      expect(CapabilitySchema.safeParse(cap).success).toBe(true);
    }
  });

  it('strictly rejects extra fields at every level', () => {
    const base = allFixtures().find((f) => f.name === 'happy.json').body;
    expect(RequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(RequestSchema.safeParse({ ...base, input: { ...base.input, extra: 1 } }).success).toBe(false);
    expect(RequestSchema.safeParse({ ...base, input: { ...base.input, context: { ...base.input.context, extra: 1 } } }).success).toBe(false);
  });

  it('accepts only ar and en locales', () => {
    const base = allFixtures().find((f) => f.name === 'happy.json').body;
    expect(RequestSchema.safeParse({ ...base, input: { ...base.input, context: { ...base.input.context, locale: 'fr' } } }).success).toBe(false);
  });
});

describe('callback contract', () => {
  it('accepts a well-formed callback result', () => {
    const ok = CallbackSchema.safeParse({
      requestId: '00000000-0000-4000-8000-000000000001',
      capability: 'supervisor_daily_summary',
      modelVersion: 'Qwen/Qwen3.8-27B@prompt-v2',
      confidence: 0.85,
      output: { hello: 'world' },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unknown capability, bad confidence and extra fields', () => {
    const base = {
      requestId: '00000000-0000-4000-8000-000000000001',
      capability: 'supervisor_daily_summary',
      modelVersion: 'v1',
      confidence: 0.5,
      output: {},
    };
    expect(CallbackSchema.safeParse({ ...base, capability: 'other' }).success).toBe(false);
    expect(CallbackSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
    expect(CallbackSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('output contract', () => {
  it('fallback outputs for every capability and locale are schema-valid and number-faithful', () => {
    for (const capId of CAPS) {
      const cap = getCapability(capId);
      for (const { name, body } of allFixtures().filter((f) => f.cap === capId)) {
        const data = body.input.context.data ?? {};
        const kpis = cap.computeKpis(data);
        const ranking = cap.computeRanking ? cap.computeRanking(data) : [];
        for (const locale of ['en', 'ar']) {
          const output = cap.fallback(locale, kpis, ranking);
          expect(OutputSchemas[capId].safeParse(output).success, `${capId}/${name}/${locale}`).toBe(true);
          expect(output.locale).toBe(locale);
          expect(checkNumbers(output, kpis).ok, `${capId}/${name}/${locale} numerals`).toBe(true);
        }
      }
    }
  });

  it('output schemas reject extra fields', () => {
    const cap = getCapability('supervisor_daily_summary');
    const out = cap.fallback('en', cap.computeKpis({}));
    expect(OutputSchemas.supervisor_daily_summary.safeParse({ ...out, extra: 1 }).success).toBe(false);
  });
});

describe('openapi document', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8');

  it('declares all four POST paths and the callback schema', () => {
    for (const cap of CAPS) {
      expect(spec, cap).toContain(`/v1/${cap}:`);
    }
    expect(spec).toContain('CallbackResult:');
    for (const cap of CAPS) expect(spec).toContain(cap);
  });

  it('documents the pending_review / suggestion-only contract', () => {
    expect(spec).toMatch(/pending_review/i);
    expect(spec).toMatch(/never writes business data/i);
  });
});
