import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_CAPABILITIES,
  AI_OUTPUT_ERROR_CODES,
  AI_SUBJECT_TYPES,
  aiCallbackSchema,
  aiServiceRequestSchema,
  findPiiProblems,
} from '../src/index.js';

// The AI service lives in a sibling repository. Without it (CI) only the local rules are checked.
const repo = fileURLToPath(new URL('../../../../fieldflow-ai/', import.meta.url));
const present = existsSync(repo + 'openapi.yaml');
const yaml = present ? readFileSync(repo + 'openapi.yaml', 'utf8') : '';

describe.skipIf(!present)(
  'local copy of the AI contract matches ../fieldflow-ai/openapi.yaml',
  () => {
    it('has the same paths, capability ids and enums', () => {
      for (const capability of AI_CAPABILITIES) expect(yaml).toContain(`/v1/${capability}:`);
      expect(yaml).toContain(`enum: [${AI_CAPABILITIES.join(', ')}]`);
      expect(yaml).toContain(`enum: [${AI_OUTPUT_ERROR_CODES.join(', ')}]`);
      expect(yaml).toContain('enum: [supervisor, campaign]');
      expect(yaml).toContain('enum: [ar, en]');
      expect(yaml).toContain('required: [requestId, agencyId, subject, input]');
      expect(yaml).toContain('required: [requestId, capability, modelVersion, confidence, output]');
      expect(yaml).toContain("pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
      expect(yaml.match(/additionalProperties: false/g)).toHaveLength(6);
    });

    it('every fixture of the AI repository is a valid request with the right subject type', () => {
      let count = 0;
      for (const capability of AI_CAPABILITIES) {
        const directory = `${repo}fixtures/${capability}/`;
        for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
          const body = JSON.parse(readFileSync(directory + file, 'utf8'));
          expect(aiServiceRequestSchema.safeParse(body).success, `${capability}/${file}`).toBe(
            true,
          );
          expect(body.subject.type).toBe(AI_SUBJECT_TYPES[capability]);
          count += 1;
        }
      }
      expect(count).toBe(20);
    });

    it('the happy fixtures pass our PII guard', () => {
      for (const capability of AI_CAPABILITIES) {
        const body = JSON.parse(readFileSync(`${repo}fixtures/${capability}/happy.json`, 'utf8'));
        expect(findPiiProblems(body.input.context.data)).toEqual([]);
      }
    });
  },
);

describe('callback schema', () => {
  const valid = {
    requestId: '00000000-0000-4000-8000-000000000001',
    capability: 'campaign_insights',
    modelVersion: 'Qwen/Qwen3.8-27B@prompt-v1',
    confidence: 0.95,
    output: { narrative: 'x' },
  };

  it('accepts the documented body and rejects unknown fields, bad ranges and long versions', () => {
    expect(aiCallbackSchema.safeParse(valid).success).toBe(true);
    expect(aiCallbackSchema.safeParse({ ...valid, agencyId: valid.requestId }).success).toBe(false);
    expect(aiCallbackSchema.safeParse({ ...valid, confidence: 1.1 }).success).toBe(false);
    expect(aiCallbackSchema.safeParse({ ...valid, modelVersion: 'x'.repeat(121) }).success).toBe(
      false,
    );
    expect(aiCallbackSchema.safeParse({ ...valid, output: 'text' }).success).toBe(false);
    expect(aiCallbackSchema.safeParse({ ...valid, capability: 'chat' }).success).toBe(false);
  });
});

describe('PII guard', () => {
  it.each([
    [{ phone: '1' }, 'forbidden key'],
    [{ list: [{ Email: 'x' }] }, 'forbidden key'],
    [{ label: '+213555123456' }, 'phone'],
    [{ label: '+213 555 123 456' }, 'digit-heavy'],
    [{ label: '0555 12 34 56' }, 'digit-heavy'],
    [{ label: 'a.b@c.dz' }, 'email'],
    [{ label: 'see https://x.dz' }, 'URL'],
    [{ label: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=' }, 'base64'],
    [{ label: 'x'.repeat(201) }, 'too long'],
  ])('flags %j', (value, reason) => {
    expect(findPiiProblems(value).join()).toContain(reason);
  });

  it('accepts counts, rates and short codes', () => {
    expect(
      findPiiProblems({ sellers: [{ label: 'S1', units: 120, target: 100 }], pos: 'PDV-031' }),
    ).toEqual([]);
  });
});
