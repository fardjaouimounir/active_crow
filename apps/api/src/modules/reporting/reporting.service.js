import { calculateKpis } from '@fieldflow/shared';
import { POLYGON_WILAYAS, geoMetricValue, polygonOf } from '@fieldflow/shared/wilayaPolygons';
import { ScopeService } from '../../core/authz/index.js';
import { campaignWhere, scoped, userWhere } from '../../core/authz/scopeFilters.js';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { clientStockTotals, reconciliation } from '../inventory/inventory.reports.js';
import * as repository from './reporting.repository.js';

const DAY = 86400000;
const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const dateText = (value) => value.toISOString().slice(0, 10);
const ownSelect = { id: true, name: true };
const referenceFilters = {
  wilayaIds: ['wilaya', 'wilayaId'],
  regionIds: ['region', 'regionId'],
  pointOfSaleIds: ['pointOfSale', 'pointOfSaleId'],
  supervisorIds: ['user', 'supervisorId', 'supervisor'],
  animateurIds: ['user', 'animateurId', 'animateur'],
};

async function context(actor, filters, db = prisma) {
  const scope = ScopeService.resolve(actor);
  if (scope.level === 'client') throw new NotFoundError();
  const instant = clock.now();
  const today = businessDate(instant);
  const to =
    filters.to ?? (filters.from ? [filters.from, today, shift(filters.from, 6)].sort()[1] : today);
  const from = filters.from ?? shift(to, -6);
  const historic =
    scope.level === 'agency' ? [] : await repository.historicalAssignments(db, scope);
  const ids = (name) => [...new Set(historic.map((row) => row[name]).filter((id) => id != null))];
  const [campaigns, historicalCampaigns] = await Promise.all([
    db.campaign.findMany({
      where: campaignWhere(scope),
      select: { ...ownSelect, startDate: true, endDate: true },
    }),
    historic.length
      ? db.campaign.findMany({
          where: { agencyId: scope.agencyId, id: { in: ids('campaignId') } },
          select: { ...ownSelect, startDate: true, endDate: true },
        })
      : [],
  ]);
  const visibleCampaigns = [
    ...new Map([...campaigns, ...historicalCampaigns].map((c) => [c.id, c])).values(),
  ];
  if (filters.campaignIds?.some((id) => !visibleCampaigns.some((campaign) => campaign.id === id)))
    throw new NotFoundError();
  if (filters.clientId) {
    const found = await db.client.findFirst({
      where: {
        id: filters.clientId,
        agencyId: scope.agencyId,
        ...(scope.level !== 'agency' && {
          campaigns: { some: { id: { in: visibleCampaigns.map(({ id }) => id) } } },
        }),
      },
      select: { id: true },
    });
    if (!found) throw new NotFoundError();
  }
  await Promise.all(
    Object.entries(referenceFilters).map(async ([param, [model, column, role]]) => {
      const requested = filters[param];
      if (!requested) return;
      const allowed =
        scope.level === 'agency' || model === 'wilaya'
          ? requested
          : requested.filter((id) => ids(column).includes(id));
      const found = await db[model].count({
        where: {
          id: { in: allowed },
          ...(model !== 'wilaya' && { agencyId: scope.agencyId }),
          ...(role && { role }),
        },
      });
      if (
        found !== requested.length ||
        (scope.level !== 'agency' &&
          model === 'wilaya' &&
          requested.some((id) => !ids(column).includes(id)))
      )
        throw new NotFoundError();
    }),
  );
  return { scope, instant, visibleCampaigns, historic, filters: { ...filters, from, to } };
}

const stockColumns = [
  'stockIn',
  'customers',
  'losses',
  'returnedToClient',
  'physical',
  'failingChecks',
];

async function stockFor(actor, ctx) {
  // Reconciliation is a current snapshot. Its campaign totals have no holder or geographical attribution.
  if (Object.keys(referenceFilters).some((key) => ctx.filters[key]))
    return { rows: [], totals: null };
  const agencyWide = ctx.scope.level === 'agency';
  const today = businessDate(ctx.instant);
  if (!agencyWide && (today < ctx.filters.from || today > ctx.filters.to))
    return { rows: [], totals: null };
  const campaigns = await prisma.campaign.findMany({
    where: scoped(campaignWhere(ctx.scope), {
      id: ctx.filters.campaignIds ? { in: ctx.filters.campaignIds } : undefined,
      clientId: ctx.filters.clientId,
      startDate: { lte: new Date(ctx.filters.to) },
      endDate: { gte: new Date(ctx.filters.from) },
    }),
    select: ownSelect,
  });
  const rows = [];
  const totals = Object.fromEntries(stockColumns.map((key) => [key, 0]));
  const team = !agencyWide && (await userWhere(ctx.scope, { at: today, reportingOnly: true }));
  const allowed = new Set(typeof team?.id === 'string' ? [team.id] : team?.id?.in);
  for (const campaign of campaigns) {
    const result = await reconciliation(actor, campaign.id);
    const visible = agencyWide
      ? result.rows
      : result.rows.filter(({ holder }) => allowed.has(holder.userId));
    rows.push(...visible.map((row) => ({ ...row, campaign: campaign.name })));
    if (agencyWide) {
      for (const key of stockColumns.slice(0, -1)) totals[key] += result.totals.all[key];
      totals.failingChecks += Number(!result.totals.balancedToZero);
    } else {
      totals.customers += visible.reduce((total, row) => total + row.distributed, 0);
      totals.physical += visible.reduce((total, row) => total + row.balance, 0);
    }
    totals.failingChecks += visible.filter((row) => !row.check.ok).length;
  }
  if (!agencyWide) {
    for (const key of ['stockIn', 'losses', 'returnedToClient']) totals[key] = null;
  }
  return { rows, totals };
}

const period = ({ from, to }) => ({ from, to });
const totals = (rows) => rows[0]?.totals ?? {};
const read = (ctx, dimension, filters = ctx.filters) =>
  repository.aggregate(prisma, ctx.scope, filters, dimension, ctx.instant);

async function choices(ctx) {
  const campaigns = ctx.visibleCampaigns;
  const { agencyId, level } = ctx.scope;
  const values = (key) => [
    ...new Set(ctx.historic.map((row) => row[key]).filter((id) => id != null)),
  ];
  const references = Object.entries(referenceFilters).map(async ([key, [model, column, role]]) => [
    key,
    await prisma[model].findMany({
      where: {
        ...(model !== 'wilaya' && { agencyId }),
        ...(role && { role }),
        ...(level !== 'agency' && { id: { in: values(column) } }),
      },
      select:
        model === 'wilaya'
          ? { id: true, nameEn: true, nameAr: true }
          : model === 'user'
            ? { id: true, fullName: true }
            : ownSelect,
    }),
  ]);
  const clients = prisma.client.findMany({
    where: { agencyId, ...(level !== 'agency' && { id: { in: values('clientId') } }) },
    select: ownSelect,
  });
  return Object.fromEntries(
    await Promise.all([
      ...references,
      ['campaignIds', campaigns],
      clients.then((rows) => ['clientId', rows]),
    ]),
  );
}

export async function kpis(actor, filters) {
  const ctx = await context(actor, filters);
  const { from, to } = ctx.filters;
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  const previous = { ...ctx.filters, from: shift(from, -days), to: shift(from, -1) };
  const recentFrom = shift(to, -6);
  const [currentRows, previousRows, stock, options, recentRows] = await Promise.all([
    read(ctx),
    read(ctx, undefined, previous),
    stockFor(actor, ctx),
    ctx.scope.level === 'self' ? null : choices(ctx),
    from > recentFrom && ctx.scope.level !== 'self'
      ? read(ctx, undefined, { ...ctx.filters, from: recentFrom })
      : null,
  ]);
  const current = totals(currentRows);
  return {
    ...calculateKpis(period(ctx.filters), current, stock.totals),
    previous: calculateKpis(period(previous), totals(previousRows)),
    alerts: {
      oldPending: current.oldPending ?? 0,
      unvisitedStores: (recentRows ? totals(recentRows) : current).unvisitedStores ?? 0,
      unvisitedInPeriod: current.unvisitedInPeriod ?? 0,
    },
    options,
  };
}

const labels = {
  campaign: ['campaign', ownSelect],
  region: ['region', ownSelect],
  point_of_sale: ['pointOfSale', ownSelect],
  wilaya: ['wilaya', { id: true, nameAr: true, nameEn: true }],
  animateur: ['user', { id: true, fullName: true }],
  supervisor: ['user', { id: true, fullName: true }],
  product: ['product', ownSelect],
};

async function grouped(ctx, dimension) {
  const rows = await read(ctx, dimension);
  if (!labels[dimension])
    return rows.map(({ bucket, totals }) => ({
      id: bucket,
      label: bucket,
      ...calculateKpis(period(ctx.filters), totals),
    }));
  const [model, select] = labels[dimension];
  const records = rows.some(({ bucket }) => bucket)
    ? await prisma[model].findMany({
        where: {
          id: {
            in: rows
              .map(({ bucket }) => (model === 'wilaya' ? Number(bucket) : bucket))
              .filter(Boolean),
          },
          ...(model !== 'wilaya' && { agencyId: ctx.scope.agencyId }),
        },
        select,
      })
    : [];
  const names = new Map(records.map(({ id, ...names }) => [String(id), names]));
  return rows.map(({ bucket, totals }) => {
    const item = names.get(bucket);
    return {
      id: bucket || null,
      label: item?.name ?? item?.fullName ?? item?.nameEn ?? null,
      labelAr: item?.nameAr ?? null,
      ...calculateKpis(period(ctx.filters), totals),
    };
  });
}

export async function breakdown(actor, filters, dimension) {
  return grouped(await context(actor, filters), dimension);
}

export async function campaignContext(actor, id) {
  const scope = ScopeService.resolve(actor);
  if (scope.level === 'client') throw new NotFoundError();
  if (scope.level !== 'agency') {
    await context(actor, { campaignIds: [id] });
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Campaign report requires agency access',
    });
  }
  const campaign = await prisma.campaign.findFirst({
    where: scoped(campaignWhere(scope), { id, status: { in: ['active', 'completed', 'closed'] } }),
    select: {
      ...ownSelect,
      code: true,
      status: true,
      startDate: true,
      endDate: true,
      client: { select: ownSelect },
      wilayas: { select: { wilaya: { select: { id: true, nameEn: true, nameAr: true } } } },
      pointsOfSale: { select: { pointOfSale: { select: ownSelect } } },
    },
  });
  if (!campaign) throw new NotFoundError();
  const filters = {
    campaignIds: [id],
    from: dateText(campaign.startDate),
    to: dateText(campaign.endDate),
  };
  return { campaign, ctx: await context(actor, filters) };
}

export async function summary(actor, id) {
  const { campaign, ctx } = await campaignContext(actor, id);
  const [raw, daily, wilayas, stores, animateurs, supervisors, reconciliation, issues] =
    await Promise.all([
      read(ctx),
      grouped(ctx, 'day'),
      grouped(ctx, 'wilaya'),
      grouped(ctx, 'point_of_sale'),
      grouped(ctx, 'animateur'),
      grouped(ctx, 'supervisor'),
      stockFor(actor, ctx),
      repository.issues(prisma, ctx.scope, ctx.filters),
    ]);
  return {
    campaign: {
      ...campaign,
      animateurCount: animateurs.length,
      supervisorCount: supervisors.length,
    },
    generatedAt: ctx.instant,
    kpis: calculateKpis(period(ctx.filters), totals(raw), reconciliation.totals),
    daily,
    wilayas,
    stores,
    issues,
    reconciliation: reconciliation.totals,
  };
}

export async function exportData(actor, filters, id) {
  const ctx = id ? (await campaignContext(actor, id)).ctx : await context(actor, filters);
  const [raw, daily, wilayas, stores, animateurs, stock, issues] = await Promise.all([
    read(ctx),
    grouped(ctx, 'day'),
    grouped(ctx, 'wilaya'),
    grouped(ctx, 'point_of_sale'),
    grouped(ctx, 'animateur'),
    stockFor(actor, ctx),
    repository.issues(prisma, ctx.scope, ctx.filters),
  ]);
  return {
    filters: ctx.filters,
    generatedAt: ctx.instant,
    kpis: calculateKpis(period(ctx.filters), totals(raw), stock.totals),
    daily,
    wilayas,
    stores,
    animateurs,
    gifts: stock.rows,
    issues,
  };
}

/**
 * Plain KPIs of the period, or of every bucket of `dimension`, with no options, alerts or stock.
 * The AI integration builds its aggregate payloads from these numbers (the dashboard's own source).
 * @returns {Promise<object | object[]>}
 */
export async function aggregates(actor, filters, dimension) {
  const ctx = await context(actor, filters);
  if (dimension) return grouped(ctx, dimension);
  return calculateKpis(period(ctx.filters), totals(await read(ctx)));
}

const PORTAL_DIMENSIONS = ['day', 'wilaya', 'point_of_sale', 'product'];

/**
 * Totals, or one of the dimensions a client may see, of a campaign for the client portal. The
 * caller has already proven the campaign belongs to the client; the numbers are agency-wide for
 * that campaign. Never Animateur or supervisor breakdowns, never anything personal.
 */
export async function portalAggregates(campaign, dimension) {
  const ctx = {
    scope: { level: 'agency', agencyId: campaign.agencyId },
    instant: clock.now(),
    filters: {
      campaignIds: [campaign.id],
      from: dateText(campaign.startDate),
      to: dateText(campaign.endDate),
    },
  };
  if (dimension) {
    if (!PORTAL_DIMENSIONS.includes(dimension)) throw new Error('Dimension not allowed');
    return grouped(ctx, dimension);
  }
  const kpis = calculateKpis(
    period(ctx.filters),
    totals(await read(ctx)),
    await clientStockTotals(campaign),
  );
  // Internal review counters are not part of the client view.
  delete kpis.gifts.toReview;
  return kpis;
}

export const reportingService = {
  kpis,
  breakdown,
  summary,
  exportData,
  aggregates,
  portalAggregates,
  geoWilayas,
  geoStores,
  geoHeatmap,
  portalGeo,
};

/* ------------------------------------------------------------------------- geography */

const pad = (id) => String(id).padStart(2, '0');
const sumTotals = (list) =>
  list.reduce((sum, totals) => {
    for (const [key, value] of Object.entries(totals))
      if (value != null && !Number.isNaN(Number(value))) sum[key] = (sum[key] ?? 0) + Number(value);
    return sum;
  }, {});
/** The KPIs a geography tooltip shows, from the same bundle every other view uses. */
const geoKpis = (kpis) => ({
  salesUnits: kpis.sales.units,
  buyers: kpis.customers.buyers,
  conversionRate: kpis.customers.conversionRate,
  attendanceRate: kpis.attendance.rate,
  giftDistributionRate: kpis.gifts.distributionRate,
  storeCoverage: kpis.visits.storeCoverage,
  undeliveredUnits: kpis.gifts.undeliveredUnits,
});
/** What a client may see of a geography bundle. */
const clientKpis = (kpis) => ({
  salesUnits: kpis.salesUnits,
  buyers: kpis.buyers,
  conversionRate: kpis.conversionRate,
  giftDistributionRate: kpis.giftDistributionRate,
});

/** Rank 1 = highest value; equal values keep a stable order; null values are not ranked. */
function ranked(rows, key) {
  const order = rows
    .filter((row) => row.value != null && row.value > 0)
    .sort((a, b) => b.value - a.value || String(a[key]).localeCompare(String(b[key])));
  order.forEach((row, index) => {
    row.rank = index + 1;
  });
  for (const row of rows) row.rank ??= null;
  return rows;
}

/**
 * One metric per wilaya and per map polygon. Wilayas created after the open boundary data (49-69)
 * are summed into the polygon they were carved out of, from raw totals (so ratios are recomputed,
 * not averaged), and `included` lists them for the tooltip.
 */
async function wilayaGeo(ctx, metric) {
  const [rows, all, wilayas] = await Promise.all([
    read(ctx, 'wilaya'),
    read(ctx),
    prisma.wilaya.findMany({ select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  const names = new Map(wilayas.map((item) => [item.id, item]));
  const kpisOf = (raw) => calculateKpis(period(ctx.filters), raw);
  const entry = (id) => ({
    id,
    nameEn: names.get(id)?.nameEn ?? null,
    nameAr: names.get(id)?.nameAr ?? null,
  });
  const present = rows.filter(({ bucket }) => bucket);
  const perWilaya = ranked(
    present.map(({ bucket, totals: raw }) => {
      const id = Number(bucket);
      const kpis = kpisOf(raw);
      return {
        wilayaId: id,
        code: pad(id),
        polygonCode: polygonOf(id),
        ...entry(id),
        value: geoMetricValue(kpis, metric),
        kpis: geoKpis(kpis),
      };
    }),
    'wilayaId',
  );
  const groups = new Map();
  for (const { bucket, totals: raw } of present) {
    const code = polygonOf(Number(bucket));
    if (code) groups.set(code, [...(groups.get(code) ?? []), raw]);
  }
  const polygons = ranked(
    [...groups].map(([polygonCode, list]) => {
      const kpis = kpisOf(sumTotals(list));
      const members = POLYGON_WILAYAS[polygonCode].map(entry);
      return {
        polygonCode,
        wilayaIds: members.map(({ id }) => id),
        members,
        included: members.filter(({ id }) => pad(id) !== polygonCode),
        value: geoMetricValue(kpis, metric),
        kpis: geoKpis(kpis),
      };
    }),
    'polygonCode',
  );
  const total = kpisOf(totals(all));
  return {
    metric,
    period: period(ctx.filters),
    total: { value: geoMetricValue(total, metric), kpis: geoKpis(total) },
    wilayas: perWilaya,
    polygons,
  };
}

export async function geoWilayas(actor, query) {
  const { metric, ...filters } = query;
  return wilayaGeo(await context(actor, filters), metric);
}

const coordinate = (value) => (value == null ? null : Number(value));
/** A usable point: both set, on Earth, and not the 0,0 default of a missing location. */
const isLocated = ({ latitude, longitude }) =>
  latitude != null &&
  longitude != null &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  !(latitude === 0 && longitude === 0);
const STORE_PLACE = {
  id: true,
  name: true,
  latitude: true,
  longitude: true,
  wilaya: { select: { id: true, nameEn: true, nameAr: true } },
};

/**
 * Stores in scope with their coordinates and the numbers the store and live maps show. Stores
 * without coordinates come back in `unlocated`, never at 0,0.
 */
export async function geoStores(actor, filters) {
  const ctx = await context(actor, filters);
  const rows = await grouped(ctx, 'point_of_sale');
  const ids = rows.map(({ id }) => id).filter(Boolean);
  const [records, visits, openIssues, today] = await Promise.all([
    prisma.pointOfSale.findMany({
      where: { id: { in: ids }, agencyId: ctx.scope.agencyId, deletedAt: null },
      select: { ...STORE_PLACE, code: true },
    }),
    repository.lastVisits(prisma, ctx.scope, ctx.filters, ids),
    repository.openIssuesByStore(prisma, ctx.scope, ctx.filters),
    repository.todayAttendanceByStore(prisma, ctx.scope, ctx.filters, ids, ctx.instant),
  ]);
  const byId = new Map(records.map((record) => [record.id, record]));
  const visitOf = new Map(visits.map(({ id, lastVisit }) => [id, lastVisit]));
  const issuesOf = new Map(openIssues.map(({ id, count }) => [id, count]));
  const todayOf = new Map(today.map(({ id, ...counts }) => [id, counts]));
  const stores = rows.flatMap((row) => {
    const record = byId.get(row.id);
    if (!record) return [];
    return [
      {
        id: record.id,
        name: record.name,
        code: record.code,
        wilaya: record.wilaya,
        latitude: coordinate(record.latitude),
        longitude: coordinate(record.longitude),
        salesUnits: row.sales.units,
        buyers: row.customers.buyers,
        attendanceRate: row.attendance.rate,
        lastVisit: visitOf.get(row.id) ? dateText(new Date(visitOf.get(row.id))) : null,
        openIssues: issuesOf.get(row.id) ?? 0,
        today: todayOf.get(row.id) ?? null,
      },
    ];
  });
  return {
    period: period(ctx.filters),
    stores: stores.filter(isLocated),
    unlocated: stores.filter((store) => !isLocated(store)),
  };
}

/** Counts per ISO weekday (1 = Monday) x Algiers hour (0-23), as a 7 x 24 matrix. */
export async function geoHeatmap(actor, query) {
  const { kind, ...filters } = query;
  const ctx = await context(actor, filters);
  const cells = await repository.timeHeatmap(prisma, ctx.scope, ctx.filters, kind);
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const { weekday, hour, count } of cells) matrix[weekday - 1][hour] += count;
  const flat = matrix.flat();
  return {
    kind,
    period: period(ctx.filters),
    matrix,
    total: flat.reduce((sum, value) => sum + value, 0),
    max: Math.max(0, ...flat),
  };
}

/**
 * Client view of one campaign (already proven to belong to the client): wilayas, or stores, with
 * sales, buyers, conversion and gift distribution only. Never attendance, visits, issues, staff or
 * stock handling.
 */
export async function portalGeo(campaign, kind, metric = 'sales_units') {
  const ctx = {
    scope: { level: 'agency', agencyId: campaign.agencyId },
    instant: clock.now(),
    filters: {
      campaignIds: [campaign.id],
      from: dateText(campaign.startDate),
      to: dateText(campaign.endDate),
    },
  };
  if (kind === 'stores') {
    const rows = await grouped(ctx, 'point_of_sale');
    const records = await prisma.pointOfSale.findMany({
      where: {
        id: { in: rows.map(({ id }) => id).filter(Boolean) },
        agencyId: campaign.agencyId,
        deletedAt: null,
      },
      select: STORE_PLACE,
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    const stores = rows.flatMap((row) => {
      const record = byId.get(row.id);
      if (!record) return [];
      return [
        {
          id: record.id,
          name: record.name,
          wilaya: record.wilaya,
          latitude: coordinate(record.latitude),
          longitude: coordinate(record.longitude),
          salesUnits: row.sales.units,
          buyers: row.customers.buyers,
        },
      ];
    });
    return { stores: stores.filter(isLocated), unlocated: stores.filter((s) => !isLocated(s)) };
  }
  const result = await wilayaGeo(ctx, metric);
  const strip = (row) => ({ ...row, kpis: clientKpis(row.kpis) });
  return {
    ...result,
    total: { value: result.total.value, kpis: clientKpis(result.total.kpis) },
    wilayas: result.wilayas.map(strip),
    polygons: result.polygons.map(strip),
  };
}
