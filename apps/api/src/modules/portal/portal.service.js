// Client portal (FR-090…FR-093). Read-only and aggregate-only: a client sees the campaigns of its
// own company with live KPIs, the proof the agency chose to share and the final report. Never a
// staff name, a breakdown by Animateur or supervisor, a coordinate or anything about a customer.
import { CLIENT_CAMPAIGN_STATUSES } from '@fieldflow/shared';
import { ScopeService } from '../../core/authz/index.js';
import { campaignWhere, scoped } from '../../core/authz/scopeFilters.js';
import { NotFoundError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { aiService } from '../ai/ai.service.js';
import { reportingService } from '../reporting/reporting.service.js';

const ISO = (value) => value.toISOString().slice(0, 10);
const SELECT = {
  id: true,
  agencyId: true,
  code: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  client: { select: { id: true, name: true } },
  wilayas: { select: { wilaya: { select: { id: true, nameEn: true, nameAr: true } } } },
};

/** Client users and agency-wide staff (the director preview); everybody else gets 404. */
function portalScope(actor) {
  const scope = ScopeService.resolve(actor);
  if (scope.level !== 'client' && scope.level !== 'agency') throw new NotFoundError();
  return scope;
}

/** The campaign when it is in the actor scope (and visible to clients), else 404. */
export async function campaignFor(actor, id) {
  const scope = portalScope(actor);
  const where = scoped(campaignWhere(scope), {
    id,
    status: { in: [...CLIENT_CAMPAIGN_STATUSES] },
  });
  return (
    (await prisma.campaign.findFirst({ where, select: SELECT })) ??
    Promise.reject(new NotFoundError())
  );
}

const summary = (campaign) => ({
  id: campaign.id,
  code: campaign.code,
  name: campaign.name,
  status: campaign.status,
  startDate: campaign.startDate,
  endDate: campaign.endDate,
  // Provisional until the campaign is closed (BR-15): the numbers can still change.
  provisional: campaign.status !== 'closed',
  client: campaign.client,
  wilayas: campaign.wilayas.map(({ wilaya }) => wilaya),
});

const headline = (kpis) => ({
  units: kpis.sales.units,
  buyers: kpis.customers.buyers,
  distributedUnits: kpis.gifts.distributedUnits,
  completionRate: kpis.completion.rate,
  targetAchievement: kpis.completion.targetAchievement,
});

export async function list(actor) {
  const scope = portalScope(actor);
  const campaigns = await prisma.campaign.findMany({
    where: scoped(campaignWhere(scope), { status: { in: [...CLIENT_CAMPAIGN_STATUSES] } }),
    select: SELECT,
    orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
  });
  return Promise.all(
    campaigns.map(async (campaign) => ({
      ...summary(campaign),
      headline: headline(await reportingService.portalAggregates(campaign)),
    })),
  );
}

export async function get(actor, id) {
  const campaign = await campaignFor(actor, id);
  const period = { from: ISO(campaign.startDate), to: ISO(campaign.endDate) };
  const [kpis, tombolas, commentary] = await Promise.all([
    reportingService.portalAggregates(campaign),
    prisma.tombola.findMany({
      where: { campaignId: id, agencyId: campaign.agencyId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, status: true, winnersCount: true, reservesCount: true },
    }),
    aiService.portalCommentary(campaign.agencyId, id, period),
  ]);
  return { ...summary(campaign), period, kpis, tombolas, commentary };
}

export async function kpis(actor, id) {
  const campaign = await campaignFor(actor, id);
  return {
    period: { from: ISO(campaign.startDate), to: ISO(campaign.endDate) },
    provisional: campaign.status !== 'closed',
    kpis: await reportingService.portalAggregates(campaign),
  };
}

export async function breakdown(actor, id, dimension) {
  const campaign = await campaignFor(actor, id);
  return reportingService.portalAggregates(campaign, dimension);
}

/** Wilaya choropleth or store map data for one campaign, redacted to the client view. */
export async function geo(actor, id, kind, metric) {
  const campaign = await campaignFor(actor, id);
  return reportingService.portalGeo(campaign, kind, metric);
}

/** Visit photos the agency shared: date, wilaya and store only. */
export async function proof(actor, id) {
  const campaign = await campaignFor(actor, id);
  const rows = await prisma.visitPhoto.findMany({
    where: {
      agencyId: campaign.agencyId,
      visit: { campaignId: id },
      file: { visibility: 'client_visible', deletedAt: null },
    },
    orderBy: [{ visit: { visitedAt: 'desc' } }, { fileId: 'asc' }],
    take: 300,
    select: {
      fileId: true,
      visit: {
        select: {
          visitedAt: true,
          pointOfSale: {
            select: { name: true, wilaya: { select: { id: true, nameEn: true, nameAr: true } } },
          },
        },
      },
    },
  });
  return rows.map(({ fileId, visit }) => ({
    fileId,
    date: ISO(visit.visitedAt),
    store: visit.pointOfSale.name,
    wilaya: visit.pointOfSale.wilaya,
  }));
}

export async function documents(actor, id) {
  const campaign = await campaignFor(actor, id);
  const rows = await prisma.campaignDocument.findMany({
    where: {
      campaignId: id,
      agencyId: campaign.agencyId,
      file: { visibility: 'client_visible', deletedAt: null },
    },
    orderBy: [{ createdAt: 'desc' }, { fileId: 'asc' }],
    select: {
      fileId: true,
      label: true,
      createdAt: true,
      file: { select: { mimeType: true, sizeBytes: true } },
    },
  });
  return rows.map(({ fileId, label, createdAt, file }) => ({
    fileId,
    label,
    createdAt,
    mimeType: file.mimeType,
    sizeBytes: Number(file.sizeBytes),
  }));
}

export const portalService = Object.freeze({
  list,
  get,
  kpis,
  breakdown,
  geo,
  proof,
  documents,
  campaignFor,
});
