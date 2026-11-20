import { z } from 'zod';

export const reportingDimensions = [
  'day',
  'wilaya',
  'region',
  'point_of_sale',
  'supervisor',
  'animateur',
  'product',
  'campaign',
];

const date = z.iso.date();
const list = (item) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value.split(',')
        : Array.isArray(value)
          ? value.flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
          : value,
    z
      .array(item)
      .min(1)
      .max(200)
      .transform((values) => [...new Set(values)])
      .optional(),
  );

const ids = list(z.uuid());

export const reportingFilterFields = {
  campaignIds: ids,
  clientId: z.uuid().optional(),
  wilayaIds: list(z.coerce.number().int().min(1).max(32767)),
  regionIds: ids,
  pointOfSaleIds: ids,
  supervisorIds: ids,
  animateurIds: ids,
  from: date.optional(),
  to: date.optional(),
};

export const reportingFilters = z
  .strictObject(reportingFilterFields)
  .refine(
    ({ from, to }) =>
      !from || !to || (from <= to && Date.parse(to) - Date.parse(from) <= 365 * 86400000),
    { path: ['to'], message: 'The date range must contain between 1 and 366 days' },
  );

const ratio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : null);

export const countBuyers = (identified, anonymous) => Number(identified) + Number(anonymous);

export function calculateKpis(period, totals, stock = null) {
  const value = (key) => Number(totals[key] ?? 0);
  const verified = value('verified');
  const pending = value('pending');
  const verifiedExpected = totals.verifiedExpected == null ? verified : value('verifiedExpected');
  const pendingExpected = totals.pendingExpected == null ? pending : value('pendingExpected');
  const expectedSlots = value('expectedSlots');
  const buyers = countBuyers(value('identifiedBuyers'), value('anonymousSales'));
  const interactions = value('interactions');
  const reach = buyers + interactions;
  const units = value('salesUnits');
  const entitledUnits = value('entitledUnits');
  const distributedUnits = value('distributedUnits');
  const elapsedDays = value('elapsedDays');
  const plannedDays = value('plannedDays');
  return {
    period,
    attendance: {
      expectedSlots,
      verified,
      pending,
      rejected: value('rejected'),
      notSent: value('notSent'),
      absentJustified: value('absentJustified'),
      absentUnjustified: value('absentUnjustified'),
      rate: ratio(verifiedExpected, expectedSlots),
      submittedRate: ratio(pendingExpected + verifiedExpected, expectedSlots),
      lateShare: ratio(value('lateRecords'), value('attendanceRecords')),
    },
    sales: { count: value('salesCount'), units },
    customers: { buyers, interactions, reach, conversionRate: ratio(buyers, reach) },
    gifts: {
      entitledUnits,
      distributedUnits,
      undeliveredUnits: value('undeliveredUnits'),
      toReview: value('giftsToReview'),
      distributionRate: ratio(distributedUnits, entitledUnits),
    },
    visits: {
      count: value('visitCount'),
      storesVisited: value('visitedStores'),
      assignedStores: value('assignedStores'),
      storeCoverage: ratio(value('visitedStores'), value('assignedStores')),
    },
    completion: {
      elapsedDays,
      plannedDays,
      rate: ratio(elapsedDays, plannedDays),
      targetAchievement: ratio(units, value('salesTarget')),
      samplingTargetAchievement: ratio(interactions, value('samplingTarget')),
      salesTarget: totals.salesTarget == null ? null : value('salesTarget'),
      samplingTarget: totals.samplingTarget == null ? null : value('samplingTarget'),
    },
    stock,
  };
}
