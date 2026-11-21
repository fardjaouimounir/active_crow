import { describe, it, expect } from 'vitest';
import { HELDOUT, buildRequest } from '../eval/scenarios-heldout.mjs';
import { SCENARIOS } from '../eval/scenarios.mjs';
import { refKpis, refDq } from '../eval/reference.mjs';
import { RequestSchema } from '../src/schemas/request.js';
import { prepareReportData, getCapability } from '../src/capabilities/index.js';
import { detectFindings, findingTopic } from '../src/pipeline/findings.js';
import { profileData } from '../src/pipeline/data-quality.js';

describe('held-out scenarios (not used to design or tune P4)', () => {
  it('are 10 new scenarios, distinct from the design set, valid in both locales and PII-clean', () => {
    expect(HELDOUT).toHaveLength(10);
    const design = new Set(SCENARIOS.map((s) => JSON.stringify(s.data)));
    for (const s of HELDOUT) {
      expect(design.has(JSON.stringify(s.data)), s.id).toBe(false);
      for (const locale of ['en', 'ar']) {
        const req = buildRequest(s, locale, '00000000-0000-4000-8000-000000000001');
        expect(RequestSchema.safeParse(req).success, `${s.id}/${locale}`).toBe(true);
        expect(() => prepareReportData(s.cap, req.input.context.data), s.id).not.toThrow();
      }
    }
  });

  it('hand-written data-quality codes equal the reference; service KPIs equal the reference', () => {
    for (const s of HELDOUT) {
      expect(refDq(s.cap, s.data).map((d) => d.code), s.id).toEqual([...s.dq].sort());
      const got = getCapability(s.cap).computeKpis(s.data);
      const want = Object.fromEntries(Object.entries(refKpis(s.cap, s.data)).filter(([, v]) => v !== null));
      expect(Object.keys(got).sort(), s.id).toEqual(Object.keys(want).sort());
      for (const [k, v] of Object.entries(want)) expect(got[k], `${s.id}.${k}`).toBeCloseTo(v, 3);
    }
  });

  it('the finding engine ranks the hand-written priority first on unseen data', () => {
    let n = 0;
    for (const s of HELDOUT.filter((x) => x.priority)) {
      const top = detectFindings(s.cap, s.data, profileData(s.cap, s.data)).find((f) => f.polarity === 'adverse');
      expect(top && findingTopic(top), s.id).toBe(s.priority);
      n += 1;
    }
    expect(n).toBe(6);
  });
});
