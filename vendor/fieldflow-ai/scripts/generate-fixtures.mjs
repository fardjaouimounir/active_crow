import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENCY = '11111111-1111-4111-8111-111111111111';

const DATA = {
  supervisor_daily_summary: {
    attendance: { present: 42, expected: 50 },
    sales: { units: 120, previousUnits: 100 },
    gifts: { distributed: 80, planned: 100 },
  },
  sales_performance: {
    sellers: [
      { label: 'S1', units: 120, target: 100 },
      { label: 'S2', units: 80, target: 100 },
    ],
    periods: [
      { label: 'P1', units: 90 },
      { label: 'P2', units: 110 },
    ],
  },
  campaign_insights: {
    attendance: { present: 42, expected: 50 },
    sales: { units: 120, target: 150 },
    gifts: { distributed: 80, planned: 100 },
  },
  animateur_coaching: {
    animateurs: [
      { label: 'A1', attendanceRate: 0.9, units: 120, target: 100, visits: 4 },
      { label: 'A2', attendanceRate: 0.7, units: 80, target: 100, visits: 2 },
    ],
  },
};

const SUBJECT = {
  supervisor_daily_summary: { type: 'supervisor', id: 'sup-001' },
  sales_performance: { type: 'campaign', id: 'cam-001' },
  campaign_insights: { type: 'campaign', id: 'cam-001' },
  animateur_coaching: { type: 'campaign', id: 'cam-001' },
};

let n = 1;
for (const [capability, data] of Object.entries(DATA)) {
  const dir = path.join(ROOT, 'fixtures', capability);
  fs.mkdirSync(dir, { recursive: true });

  const make = (locale, payloadData, extra = {}) => ({
    requestId: uuid(n++),
    agencyId: AGENCY,
    subject: SUBJECT[capability],
    input: {
      text: null,
      fileUrl: null,
      context: {
        workDate: '2026-11-20',
        from: '2026-11-01',
        to: '2026-11-20',
        locale,
        data: payloadData,
        ...extra,
      },
    },
  });

  const fixtures = {
    'happy.json': make('en', data),
    'empty.json': make('en', {}),
    'arabic.json': make('ar', data),
    'malformed-output.json': make('en', data),
    'provider-error.json': make('en', data),
  };

  for (const [name, body] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify(body, null, 2)}\n`);
  }
}

console.log('Generated 20 fixtures.');
