import { ScopeService, SYSTEM_SCOPE } from '../../core/authz/index.js';
import { BusinessRuleError } from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { maskedCustomer, problem, required } from './sales.policies.js';
import * as sales from './sales.repository.js';
import * as repo from './tombola.repository.js';

function configuration(input, campaign) {
  const registrationEndsAt = new Date(input.registrationEndsAt);
  const drawScheduledAt = new Date(input.drawScheduledAt);
  const firstDayAfterDeadline = new Date(
    campaign.endDate.toISOString().slice(0, 10) + 'T00:00:00+01:00',
  );
  if (
    +registrationEndsAt >= +firstDayAfterDeadline + 8 * 86_400_000 ||
    drawScheduledAt < registrationEndsAt
  ) {
    throw new BusinessRuleError('Tombola deadlines are outside the allowed period');
  }
  return { ...input, registrationEndsAt, drawScheduledAt };
}

export function configure(actor, id, input, patch = false) {
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    const existing = patch ? required(await repo.tombola(tx, scope, id)) : null;
    const campaignId = existing?.campaignId ?? id;
    await sales.lockCampaign(tx, scope, campaignId, true);
    const campaign = required(await sales.campaign(tx, scope, campaignId));
    if (patch) await repo.lock(tx, scope, [id]);
    const current = patch ? required(await repo.tombola(tx, scope, id)) : null;
    if (
      !['draft', 'planning', 'assigned'].includes(campaign.status) ||
      (current && (current.status !== 'open' || (await repo.count(tx, scope, { tombolaId: id }))))
    ) {
      throw problem('TOMBOLA_LOCKED', 409, 'Tombola configuration is locked');
    }
    const values = current
      ? {
          name: current.name,
          entryBasis: current.entryBasis,
          entriesPerBasis: current.entriesPerBasis,
          maxEntriesPerCustomer: current.maxEntriesPerCustomer,
          requiresPurchase: current.requiresPurchase,
          registrationEndsAt: current.registrationEndsAt,
          drawScheduledAt: current.drawScheduledAt,
          winnersCount: current.winnersCount,
          reservesCount: current.reservesCount,
          ...input,
        }
      : input;
    const data = configuration(values, campaign);
    return patch
      ? repo.update(tx, scope, id, data)
      : repo.create(tx, scope, { ...data, campaignId });
  });
}

export function close(actor, id) {
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    await repo.lock(tx, scope, [id]);
    const row = required(await repo.tombola(tx, scope, id));
    required(await sales.campaign(tx, scope, row.campaignId));
    if (row.status !== 'open') throw problem('TOMBOLA_NOT_OPEN', 409, 'Tombola is not open');
    return repo.update(tx, scope, id, { status: 'closed' });
  });
}

export async function list(actor, campaignId) {
  const scope = ScopeService.resolve(actor);
  const campaign = await sales.campaign(prisma, scope, campaignId);
  const counts = new Map();
  if (['regional', 'supervisor'].includes(scope.level)) {
    for (const group of await repo.entryCountsBySale(prisma, scope, campaignId)) {
      if (await sales.saleVisible(prisma, scope, group)) {
        counts.set(group.tombolaId, (counts.get(group.tombolaId) ?? 0) + group.entryCount);
      }
    }
  }
  required(campaign || counts.size);
  return (await repo.campaignTombolas(prisma, scope, campaignId))
    .map(({ _count, ...row }) => ({
      ...row,
      entryCount:
        scope.level === 'agency'
          ? _count.entries
          : scope.level === 'client'
            ? null
            : (counts.get(row.id) ?? 0),
    }))
    .filter((row) => campaign || counts.has(row.id));
}

export async function entries(actor, id, { status, number, page, pageSize }) {
  const scope = ScopeService.resolve(actor);
  const tombola = required(await repo.tombola(prisma, scope, id));
  let visibility = {};
  if (scope.level === 'supervisor') visibility = { sale: { supervisorId: scope.userId } };
  if (scope.level === 'regional') {
    const ids = [];
    const allowed = new Map();
    for (const row of await repo.entryScopes(prisma, scope, id)) {
      const key = row.supervisorId + ':' + row.workDate.toISOString();
      if (!allowed.has(key)) allowed.set(key, await sales.saleVisible(prisma, scope, row));
      if (allowed.get(key)) ids.push(row.id);
    }
    visibility = { saleId: { in: ids } };
  }
  const base = { tombolaId: id, ...visibility };
  const campaign = await sales.campaign(prisma, scope, tombola.campaignId);
  if (!campaign) required(await repo.count(prisma, scope, base));
  const where = { ...base, status, entryNumber: number };
  const [rows, total] = await Promise.all([
    repo.entries(prisma, scope, where, (page - 1) * pageSize, pageSize),
    repo.count(prisma, scope, where),
  ]);
  return {
    data: rows.map(({ customer, ...row }) => ({ ...row, customer: maskedCustomer(customer) })),
    meta: { page, pageSize, total },
  };
}

export const closeExpired = () =>
  withTransaction((tx) => repo.closeExpired(tx, SYSTEM_SCOPE, clock.now()));
