import { z } from 'zod';
import { USER_ROLES } from './enums.js';
import { algerianPhoneSchema } from './organization.js';

const text = (max) => z.string().trim().min(1).max(max);
const fields = {
  fullName: text(200),
  email: z.email().max(254).toLowerCase(),
  phone: algerianPhoneSchema.nullable(),
  wilayaId: z.int().min(1).max(32767).nullable(),
  communeId: z.int().positive().nullable(),
  profile: z.strictObject({
    experienceYears: z.int().min(0).max(100).nullable().optional(),
    languages: z.array(text(50)).max(30).optional(),
    skills: z.array(text(100)).max(100).optional(),
    notes: text(3000).nullable().optional(),
  }),
};

export const createUserSchema = z.strictObject({
  ...fields,
  role: z.enum(USER_ROLES),
  managerId: z.uuid().optional(),
  phone: fields.phone.optional(),
  wilayaId: fields.wilayaId.optional(),
  communeId: fields.communeId.optional(),
  profile: fields.profile.optional(),
});

export const updateUserSchema = z
  .strictObject(fields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one field');

export const transferSchema = z.strictObject({
  newManagerId: z.uuid(),
  effectiveDate: z.iso.date(),
  reason: z.string().trim().min(1).max(1000),
});

const wilaya = z.int().min(1).max(32767);
export const createRegionSchema = z.strictObject({ name: text(150), code: text(40) });
export const updateRegionSchema = createRegionSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const regionWilayasSchema = z.strictObject({
  wilayaIds: z
    .array(wilaya)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});

const point = z.strictObject({
  code: text(40),
  name: text(150),
  type: text(80),
  wilayaId: wilaya,
  communeId: z.int().positive().nullish(),
  address: text(500).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  contactName: text(200).nullish(),
  contactPhone: algerianPhoneSchema.nullish(),
});

const both = (value) =>
  (value.latitude == null) === (value.longitude == null) &&
  (value.latitude === undefined) === (value.longitude === undefined);
const coordinates = { path: ['longitude'], message: 'Provide both coordinates, or clear both' };

export const createPointSchema = point.refine(
  (value) => (value.latitude == null) === (value.longitude == null),
  coordinates,
);
export const updatePointSchema = point
  .partial()
  .extend({ version: z.int().positive() })
  .refine(both, coordinates);

const splitList = (value) =>
  value
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter(Boolean);
const profileForm = fields.profile.extend({
  skills: z.string().transform(splitList).pipe(fields.profile.shape.skills).optional(),
  languages: z.string().transform(splitList).pipe(fields.profile.shape.languages).optional(),
});

export const createUserFormSchema = createUserSchema
  .extend({ profile: profileForm.optional() })
  .superRefine(({ role, managerId }, ctx) => {
    if (role !== 'general_manager' && !managerId)
      ctx.addIssue({ code: 'custom', path: ['managerId'], message: 'Choose a manager' });
  });
export const updateUserFormSchema = updateUserSchema.safeExtend({
  profile: profileForm.optional(),
});

const coordinateFormField = (schema) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? (value === '' ? null : Number(value)) : value),
    schema,
  );
const pointCoordinates = {
  latitude: coordinateFormField(point.shape.latitude),
  longitude: coordinateFormField(point.shape.longitude),
};
export const createPointFormSchema = createPointSchema.safeExtend(pointCoordinates);
export const updatePointFormSchema = updatePointSchema.safeExtend(pointCoordinates);
