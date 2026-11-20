import { attendanceReason, attendanceOverride, today, visitInput } from '@fieldflow/shared';
export { absenceBody } from '@fieldflow/shared';
import { z } from 'zod';

export const params = z.strictObject({ id: z.uuid() });
export const empty = z.strictObject({});
const coordinate = (min, max) =>
  z
    .union([z.number(), z.string().trim().min(1)])
    .pipe(z.coerce.number().min(min).max(max))
    .optional();
const gps = { latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) };
const paired = (body) => (body.latitude === undefined) === (body.longitude === undefined);
export const checkpointBody = z.strictObject({
  checkpoint: z.string().trim().min(1).max(60),
  ...gps,
  gpsAccuracyM: coordinate(0, 10_000).refine(
    (value) => value === undefined || Number.isInteger(value),
  ),
});
export const rejectBody = attendanceReason;
export const overrideBody = attendanceOverride;
export const bulkBody = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) });
export const boardQuery = z.strictObject({ date: z.iso.date() });
function range(schema) {
  return schema
    .transform(({ from, to, ...filters }) => {
      const end = to ?? today();
      const start = from ?? new Date(+new Date(end) - 30 * 86_400_000).toISOString().slice(0, 10);
      return { ...filters, from: start, to: end };
    })
    .refine(({ from, to }) => from <= to && +new Date(to) - +new Date(from) < 62 * 86_400_000, {
      path: ['from'],
      message: 'Date range must be 1–62 days',
    });
}
const dates = { from: z.iso.date().optional(), to: z.iso.date().optional() };
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
export const recordQuery = range(
  z.strictObject({
    ...dates,
    ...paging,
    sort: z.enum(['recordedAt', '-recordedAt']).default('-recordedAt'),
    status: z.enum(['pending', 'verified', 'rejected']).optional(),
    animateurId: z.uuid().optional(),
    pointOfSaleId: z.uuid().optional(),
    flag: z.enum(['late', 'far_from_pos', 'low_gps_accuracy', 'pos_without_location']).optional(),
  }),
);
export const visitQuery = range(
  z.strictObject({
    ...dates,
    ...paging,
    sort: z.enum(['visitedAt', '-visitedAt']).default('-visitedAt'),
    supervisorId: z.uuid().optional(),
    pointOfSaleId: z.uuid().optional(),
  }),
);
function jsonList(schema) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);
}
export const visitBody = visitInput
  .extend({
    ...gps,
    observedAnimateurIds: jsonList(visitInput.shape.observedAnimateurIds),
    issues: jsonList(visitInput.shape.issues),
  })
  .refine(paired, { path: ['longitude'], message: 'Coordinates must be supplied together' });
