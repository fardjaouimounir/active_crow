import { describe, expect, it } from 'vitest';
import { REQUIRED_RULE_TYPES, RULE_SCHEMAS, RULE_TYPES, validateRuleConfig } from '../src/index.js';

const label = { ar: 'نقطة', en: 'Checkpoint' };
const checkpoint = (over = {}) => ({
  code: 'morning',
  label,
  window: ['08:30', '09:30'],
  photo: true,
  gps: false,
  ...over,
});
const attendance = (over = {}) => ({
  checkpoints: [checkpoint()],
  lateToleranceMinutes: 15,
  autoVerifyAfterHours: null,
  maxDistanceMeters: null,
  ...over,
});
const id = '77111111-1111-4111-8111-111111111111';
const question = (over = {}) => ({
  code: 'sold_out',
  label,
  type: 'yes_no',
  required: true,
  ...over,
});

const VALID = {
  attendance: attendance({
    checkpoints: [
      checkpoint({ gps: true }),
      checkpoint({ code: 'after_break', window: ['13:30', '14:15'] }),
    ],
    maxDistanceMeters: 300,
  }),
  uniform: { required: true, description: label },
  sales_target: { dailyUnitsPerAnimateur: 40, perProduct: [{ productId: id, dailyUnits: 10 }] },
  sampling_target: { dailySamplesPerAnimateur: 100, stockItemId: id },
  customer_fields: { fullName: 'required', phone: 'optional', consentRequired: true },
  daily_report: { required: true, questions: [question()] },
};

/** [rule type, why, config, path of the first issue] */
const INVALID = [
  ['attendance', 'no checkpoint', attendance({ checkpoints: [] }), 'checkpoints'],
  [
    'attendance',
    'five checkpoints',
    attendance({
      checkpoints: ['aa', 'bb', 'cc', 'dd', 'ee'].map((code, index) =>
        checkpoint({ code, window: [`0${index}:00`, `0${index}:30`] }),
      ),
    }),
    'checkpoints',
  ],
  [
    'attendance',
    'bad code',
    attendance({ checkpoints: [checkpoint({ code: 'Morning1' })] }),
    'checkpoints.0.code',
  ],
  [
    'attendance',
    'duplicate code',
    attendance({
      checkpoints: [checkpoint(), checkpoint({ window: ['10:00', '11:00'] })],
    }),
    'checkpoints.1.code',
  ],
  [
    'attendance',
    'malformed time',
    attendance({ checkpoints: [checkpoint({ window: ['8:30', '09:30'] })] }),
    'checkpoints.0.window.0',
  ],
  [
    'attendance',
    'start after end',
    attendance({ checkpoints: [checkpoint({ window: ['10:00', '09:00'] })] }),
    'checkpoints.0.window.1',
  ],
  [
    'attendance',
    'overlap',
    attendance({
      checkpoints: [checkpoint(), checkpoint({ code: 'later', window: ['09:00', '10:00'] })],
    }),
    'checkpoints.1.window.0',
  ],
  [
    'attendance',
    'out of order',
    attendance({
      checkpoints: [checkpoint(), checkpoint({ code: 'early', window: ['06:00', '07:00'] })],
    }),
    'checkpoints.1.window.0',
  ],
  [
    'attendance',
    'gps without a distance',
    attendance({ checkpoints: [checkpoint({ gps: true })] }),
    'maxDistanceMeters',
  ],
  [
    'attendance',
    'late tolerance',
    attendance({ lateToleranceMinutes: 121 }),
    'lateToleranceMinutes',
  ],
  ['attendance', 'auto verify', attendance({ autoVerifyAfterHours: 0 }), 'autoVerifyAfterHours'],
  ['attendance', 'distance too small', attendance({ maxDistanceMeters: 49 }), 'maxDistanceMeters'],
  ['attendance', 'unknown key', attendance({ extra: 1 }), ''],
  ['uniform', 'missing flag', { description: null }, 'required'],
  [
    'sales_target',
    'zero target',
    { dailyUnitsPerAnimateur: 0, perProduct: [] },
    'dailyUnitsPerAnimateur',
  ],
  [
    'sales_target',
    'duplicate product',
    {
      dailyUnitsPerAnimateur: 5,
      perProduct: [
        { productId: id, dailyUnits: 1 },
        { productId: id, dailyUnits: 2 },
      ],
    },
    'perProduct.1.productId',
  ],
  ['sampling_target', 'no stock item', { dailySamplesPerAnimateur: 5 }, 'stockItemId'],
  [
    'sampling_target',
    'too many samples',
    { dailySamplesPerAnimateur: 10001, stockItemId: id },
    'dailySamplesPerAnimateur',
  ],
  [
    'customer_fields',
    'unknown mode',
    { fullName: 'always', phone: 'optional', consentRequired: false },
    'fullName',
  ],
  [
    'daily_report',
    'eleven questions',
    {
      required: true,
      questions: Array.from({ length: 11 }, (_, index) =>
        question({ code: 'q_' + 'a'.repeat(index + 1) }),
      ),
    },
    'questions',
  ],
  [
    'daily_report',
    'duplicate question',
    { required: false, questions: [question(), question()] },
    'questions.1.code',
  ],
  [
    'daily_report',
    'bad type',
    { required: false, questions: [question({ type: 'photo' })] },
    'questions.0.type',
  ],
];

describe('rule schemas', () => {
  it('cover every rule type and require attendance and customer fields', () => {
    expect(Object.keys(RULE_SCHEMAS).sort()).toEqual([...RULE_TYPES].sort());
    expect(REQUIRED_RULE_TYPES).toEqual(['attendance', 'customer_fields']);
  });

  it.each(RULE_TYPES)('accepts a valid %s config', (type) => {
    expect(validateRuleConfig(type, VALID[type]).success).toBe(true);
  });

  it('accepts a single checkpoint, optional limits and an empty question list', () => {
    expect(validateRuleConfig('attendance', attendance()).success).toBe(true);
    expect(validateRuleConfig('daily_report', { required: false, questions: [] }).success).toBe(
      true,
    );
    expect(validateRuleConfig('uniform', { required: false, description: null }).success).toBe(
      true,
    );
  });

  it.each(INVALID)('%s: rejects %s', (type, _why, config, path) => {
    const result = validateRuleConfig(type, config);
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it('reports unknown rule types and unknown keys', () => {
    expect(validateRuleConfig('bonus', {}).success).toBe(false);
    expect(validateRuleConfig('uniform', { ...VALID.uniform, extra: true }).success).toBe(false);
  });
});
