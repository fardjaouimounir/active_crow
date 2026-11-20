// Catalog (M2): clients, products, gifts and samples. Shared by the API validators and web forms.
import { z } from 'zod';
import { stockItemKindSchema } from './enums.js';
import { algerianPhoneSchema } from './organization.js';

/** Largest amount a `numeric(14,2)` column holds. */
export const MONEY_MAX = '999999999999.99';

/**
 * Money travels in JSON as a decimal string, never a JS number (CLAUDE.md §6): ≥ 0, at most two
 * decimals, ≤ 999 999 999 999.99. Parsed values are canonical with two decimals (`"1250.5"` →
 * `"1250.50"`).
 */
export const moneySchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Use a decimal string with at most two decimals')
  .transform((value) => {
    const [units, cents = ''] = value.split('.');
    return units + '.' + cents.padEnd(2, '0');
  });

const ARABIC_DIGITS = /[٠-٩]/g;

/**
 * Normalises what a person types into a decimal string: `1250`, `1250.5`, `1 250,50`, `1,250.50`
 * and Arabic-Indic digits all become `1250`, `1250.5`, `1250.50`… Unparseable text is returned
 * unchanged so `moneySchema` reports it.
 * @param {unknown} value
 * @returns {unknown}
 */
export function normalizeMoneyInput(value) {
  if (typeof value !== 'string') return value;
  let text = value
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/[\s٬']/g, '');
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  }
  return text;
}

/** Form field: accepts localised input, empty means "no price". */
export const moneyInputSchema = z.preprocess(
  (value) => (value === '' || value == null ? null : normalizeMoneyInput(value)),
  moneySchema.nullable(),
);

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => text(max).nullable().optional();

/** Upper-cased on input, then `^[A-Z0-9][A-Z0-9-_]{0,39}$`. */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'Use letters, digits, - and _ (max 40)');

const atLeastOne = (value) => Object.keys(value).length > 0;
const nonEmpty = { message: 'Provide at least one field' };

export const createClientSchema = z.strictObject({
  name: text(120),
  legalName: optionalText(200),
  contactName: optionalText(120),
  contactEmail: z.email().max(254).toLowerCase().nullable().optional(),
  contactPhone: algerianPhoneSchema.nullable().optional(),
});
export const updateClientSchema = createClientSchema.partial().refine(atLeastOne, nonEmpty);

export const createProductSchema = z.strictObject({
  sku: skuSchema,
  name: text(120),
  unitLabel: text(40),
  referencePrice: moneySchema.nullable().optional(),
});
export const updateProductSchema = createProductSchema.partial().refine(atLeastOne, nonEmpty);

export const createStockItemSchema = z.strictObject({
  kind: stockItemKindSchema,
  sku: skuSchema,
  name: text(120),
  unitLabel: text(40),
});
export const updateStockItemSchema = createStockItemSchema.partial().refine(atLeastOne, nonEmpty);

/** Portal account form (POST /users with role `client`). */
export const createPortalUserFormSchema = z.strictObject({
  fullName: text(200),
  email: z.email().max(254).toLowerCase(),
  phone: algerianPhoneSchema.nullable().optional(),
});

const emptyToNull = (schema) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema,
  );

export const clientFormSchema = createClientSchema.safeExtend({
  legalName: emptyToNull(createClientSchema.shape.legalName),
  contactName: emptyToNull(createClientSchema.shape.contactName),
  contactEmail: emptyToNull(createClientSchema.shape.contactEmail),
  contactPhone: emptyToNull(createClientSchema.shape.contactPhone),
});
export const productFormSchema = createProductSchema.safeExtend({
  referencePrice: moneyInputSchema.optional(),
});
