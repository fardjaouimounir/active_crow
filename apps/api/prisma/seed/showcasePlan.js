// The showcase "script": pure functions that decide what every Animateur does on a given day
// (attendance, sales, samples) so the generated data carries the patterns the dashboards and the AI
// are meant to find. Nothing here touches the database or the clock; the same inputs always give the
// same plan, which is what lets `--refresh-today` run again and again without duplicating anything.
import { createHash } from 'node:crypto';
import * as data from './showcaseData.js';

// ─── Dates and randomness ────────────────────────────────────────────────────

export function rand(key) {
  return createHash('sha1').update(String(key)).digest().readUInt32BE(0) / 4_294_967_296;
}
export const pick = (list, key) => list[Math.floor(rand(key) * list.length)];
export function addDays(iso, days) {
  const date = new Date(iso + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
export const weekdayOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
export const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// ─── The cast ────────────────────────────────────────────────────────────────

export const SPECS = new Map(
  data.ANIMATEURS.map(([key, name, wilayaId, store, factor, story]) => [
    key,
    { key, name, wilayaId, store, factor, story: story ?? null },
  ]),
);
export const supervisorKeyOf = (wilayaId) => data.WILAYA_PLAN[wilayaId][1];
export const regionalKeyOf = (wilayaId) => data.WILAYA_PLAN[wilayaId][0];

/** Knobs of the story (all in one place so they are easy to calibrate). */
export const KNOBS = {
  baseAbsence: 0.05,
  lowAttendanceTeam: { supervisor: 'S4', absence: 0.32 },
  weakAbsence: 0.1,
  lateShare: 0.06,
  missedClosing: 0.06,
  fridayFactor: 0.55,
  weakWilaya: { wilayaId: 25, factor: 0.66 },
  supervisorBoostToday: { supervisor: 'S1', factor: 1.2 },
  growth: [0.95, 1.25], // sales level at the start and at the end of a campaign
  anonymousShare: 0.3,
  consentShare: 0.6,
  customerPool: 2500,
  weakLateAges: [6, 5, 3, 1], // days ago: the 4 late check-ins of the last 7 days
  farCheckin: { key: 'nabil.guerfi', age: 3 },
};

/** Gifts of one sale line under the demo promotion: quantity 1–2 → 1 gift, 3 or more → 2. */
export const giftUnits = (quantity) => (quantity >= 3 ? 2 : 1);
/** Product slots: 0 and 1 earn the matching gift, 2 earns none. */
export const PRODUCT_WEIGHTS = [0.4, 0.35, 0.25];

// ─── Who works where, when ───────────────────────────────────────────────────

export function datesOf(today, campaign) {
  return {
    start: addDays(today, campaign.startOffset),
    end: addDays(today, campaign.endOffset),
  };
}

/** Date range an Animateur is assigned to a campaign (null = not part of it). */
export function assignmentWindow(today, campaign, key) {
  const { start, end } = datesOf(today, campaign);
  if (campaign.status === 'planning') return null;
  const { replaced, replacement, leaveOffset } = data.REPLACEMENT;
  const leave = addDays(today, leaveOffset);
  if (campaign.key === 'najma') {
    if (key === replaced) return { from: start, to: leave };
    if (key === replacement) return { from: addDays(leave, 1), to: end };
  }
  return { from: start, to: end };
}

// ─── One Animateur, one day ──────────────────────────────────────────────────

function growthOn(date, { start, end }) {
  const span = Math.max(1, daysBetween(start, end));
  const t = Math.min(1, Math.max(0, daysBetween(start, date) / span));
  const [from, to] = KNOBS.growth;
  return from + (to - from) * t;
}

/** Units the Animateur should sell on `date` (before rounding into sales). */
export function dailyUnits({ today, campaign, key, date }) {
  const spec = SPECS.get(key);
  const window = datesOf(today, campaign);
  let factor = spec.factor;
  if (spec.wilayaId === KNOBS.weakWilaya.wilayaId) factor *= KNOBS.weakWilaya.factor;
  let units =
    campaign.targets.dailyUnitsPerAnimateur *
    factor *
    growthOn(date, window) *
    (weekdayOf(date) === 5 ? KNOBS.fridayFactor : 1) *
    (0.94 + 0.12 * rand(`${key}${date}noise`));
  const boost = KNOBS.supervisorBoostToday;
  if (
    date === today &&
    campaign.status === 'active' &&
    supervisorKeyOf(spec.wilayaId) === boost.supervisor
  )
    units *= boost.factor;
  return Math.max(0, Math.round(units));
}

function pickProduct(key) {
  const x = rand(key);
  let sum = 0;
  for (const [index, weight] of PRODUCT_WEIGHTS.entries()) {
    sum += weight;
    if (x < sum) return index;
  }
  return PRODUCT_WEIGHTS.length - 1;
}

/** Customer of a sale: null for an anonymous one, otherwise a stable person with a fake phone. */
export function customerFor(campaign, seed) {
  if (rand(`${seed}anon`) < KNOBS.anonymousShare) return null;
  const number = Math.floor(rand(`${seed}who`) * KNOBS.customerPool);
  const offset = campaign.key === 'nour' ? 0 : campaign.key === 'najma' ? 3000 : 6000;
  const person = number + offset;
  return {
    number: person,
    fullName: `${pick(data.FIRST_NAMES, `fn${person}`)} ${pick(data.FAMILY_NAMES, `ln${person}`)}`,
    // 0555 00 xxxx: a range that does not belong to any operator subscriber.
    phone: `055500${String(person % 10_000).padStart(4, '0')}`,
    consent: rand(`consent${person}`) < KNOBS.consentShare,
  };
}

/**
 * The plan of one Animateur on one day (future days too: they size the stock). `null` when he does not work that day.
 * @returns {null | {
 *   absence: null | 'justified' | 'unjustified', checkin: string | null, late: boolean,
 *   far: boolean, accuracy: number, sales: Array<{ minute: number, productIndex: number,
 *   quantity: number, customer: object | null }>, samples: number, closing: string | null }}
 */
export function planDay({ today, campaign, key, date }) {
  const window = assignmentWindow(today, campaign, key);
  if (!window || date < window.from || date > window.to) return null;
  const spec = SPECS.get(key);
  const age = daysBetween(date, today);
  const seed = `${key}${date}`;
  const active = campaign.key === 'najma';
  const supervisor = supervisorKeyOf(spec.wilayaId);
  const { replaced, leaveOffset } = data.REPLACEMENT;
  const forcedLate = active && spec.story === 'weak' && KNOBS.weakLateAges.includes(age);

  let absence = null;
  if (active && key === replaced && age === -leaveOffset) absence = 'justified';
  else if (age > 0 && !forcedLate) {
    const lowTeam = KNOBS.lowAttendanceTeam;
    const chance =
      supervisor === lowTeam.supervisor
        ? lowTeam.absence
        : spec.story === 'weak'
          ? KNOBS.weakAbsence
          : KNOBS.baseAbsence;
    if (rand(`${seed}abs`) < chance)
      absence =
        rand(`${seed}just`) < (supervisor === lowTeam.supervisor ? 0.2 : 0.5)
          ? 'justified'
          : 'unjustified';
  }
  const empty = {
    absence,
    checkin: null,
    late: false,
    far: false,
    accuracy: 10,
    sales: [],
    samples: 0,
    closing: null,
  };
  if (absence) return empty;

  const weakQuiet = active && spec.story === 'weak' && age <= 6 && !forcedLate;
  const late = forcedLate || (!weakQuiet && rand(`${seed}late`) < KNOBS.lateShare);
  const minute = late
    ? 8 * 60 + 50 + Math.floor(rand(`${seed}lm`) * 90)
    : 8 * 60 + 30 + Math.floor(rand(`${seed}om`) * 14);
  const far = active && key === KNOBS.farCheckin.key && age === KNOBS.farCheckin.age;
  const accuracy =
    active && key === 'adel.rahmani' && age === 1 ? 190 : 6 + Math.floor(rand(`${seed}gps`) * 30);

  const units = dailyUnits({ today, campaign, key, date });
  const sales = [];
  for (let sold = 0, index = 0; sold < units && index < 60; index++) {
    const x = rand(`${seed}q${index}`);
    const quantity = Math.min(units - sold, x < 0.35 ? 1 : x < 0.8 ? 2 : 3);
    const spread = (rand(`${seed}t${index}`) + rand(`${seed}u${index}`)) / 2;
    sales.push({
      minute: 10 * 60 + Math.floor(spread * 500),
      productIndex: pickProduct(`${seed}p${index}`),
      quantity,
      customer: customerFor(campaign, `${seed}c${index}`),
    });
    sold += quantity;
  }
  sales.sort((a, b) => a.minute - b.minute);

  const samples = Math.max(
    6,
    Math.round(
      campaign.targets.dailySamplesPerAnimateur * spec.factor * (0.8 + 0.4 * rand(`${seed}s`)),
    ),
  );
  const closing =
    age > 0 && rand(`${seed}noclose`) < KNOBS.missedClosing
      ? null
      : toHHMM(17 * 60 + 10 + Math.floor(rand(`${seed}cl`) * 80));
  return { absence: null, checkin: toHHMM(minute), late, far, accuracy, sales, samples, closing };
}

/**
 * Gift units an Animateur hands over between two dates (inclusive), per gift slot [0, 1]:
 * used to size the stock he receives.
 */
export function giftNeed({ today, campaign, key, from, to }) {
  const need = [0, 0];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const plan = planDay({ today, campaign, key, date });
    if (!plan) continue;
    for (const sale of plan.sales)
      if (sale.productIndex < 2) need[sale.productIndex] += giftUnits(sale.quantity);
  }
  return need;
}
