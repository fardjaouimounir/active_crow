import { evaluatePromotions } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { ScopeService } from '../../core/authz/index.js';
import { events } from '../../core/events/index.js';
import { runIdempotent } from '../../core/http/idempotency.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { assertFieldEntry, coversDay } from '../../core/time/fieldEntry.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { ruleSetsService } from '../campaigns/ruleSets.service.js';
import { fileService } from '../files/files.service.js';
import { distribute, lockDistributionBalances } from '../inventory/inventory.service.js';
import { mine as inventoryMine } from '../inventory/inventory.reports.js';
import { issueService } from '../issues/issues.service.js';
import { maskedCustomer, normalizePhone, problem, required } from './sales.policies.js';
import * as repo from './sales.repository.js';
import * as tombolas from './tombola.repository.js';

const dateValue = (date) => new Date(date + 'T00:00:00.000Z');
const units = (items) => items.reduce((sum, item) => sum + item.quantity, 0);

async function fieldAssignment(tx, scope, actor, id, date) {
  const first = required(await repo.assignment(tx, scope, id));
  if (first.animateurId !== actor.id)
    throw problem('NOT_ASSIGNMENT_OWNER', 404, 'Assignment not found');
  await repo.lockCampaign(tx, scope, first.campaignId);
  const assignment = required(await repo.lockAssignment(tx, scope, id));
  assertFieldEntry(assignment, date);
  return assignment;
}

function customerInput(body, rule) {
  const missing = [];
  for (const field of ['fullName', 'phone']) {
    if (rule[field] === 'required' && !body?.[field]) missing.push(field);
  }
  if (rule.consentRequired && !body?.consentTombola) missing.push('consentTombola');
  if (missing.length)
    throw problem('CUSTOMER_FIELDS_REQUIRED', 422, 'Required customer fields are missing', {
      fields: missing,
    });
  return {
    fullName: rule.fullName === 'hidden' ? undefined : body?.fullName,
    phone: rule.phone === 'hidden' ? undefined : normalizePhone(body?.phone),
    consentTombola: body?.consentTombola,
  };
}

export function saleView(row) {
  const { giftEntitlements, customer, tombolaEntries = [], workDate, ...rest } = row;
  return {
    ...rest,
    workDate: workDate.toISOString().slice(0, 10),
    units: units(row.items),
    customer: maskedCustomer(customer),
    entitlements: giftEntitlements.map(({ distributionMovement, ...item }) => ({
      ...item,
      deliveryMovementId: distributionMovement?.id ?? null,
    })),
    tombolaEntries: tombolaEntries.map(({ id, tombola, entryNumber, status, excludedReason }) => ({
      id,
      tombola,
      entryNumber,
      status,
      excludedReason,
    })),
  };
}

export function record(req) {
  const { actor, params, body, file } = req;
  const scope = ScopeService.resolve(actor);
  const soldAt = clock.now();
  const date = businessDate(soldAt);
  return runIdempotent(
    req,
    async (tx) => {
      const assignment = await fieldAssignment(tx, scope, actor, params.id, date);
      const { campaignId, pointOfSaleId, supervisorId } = assignment;
      const items = body.items.map(({ productId, quantity }) => ({
        productId: productId.toLowerCase(),
        quantity,
      }));
      if (
        (await repo.productCount(
          tx,
          scope,
          campaignId,
          items.map((item) => item.productId),
        )) !== items.length
      ) {
        throw problem('PRODUCT_NOT_IN_CAMPAIGN', 422, 'All products must belong to the campaign');
      }
      const version = await ruleSetsService.effective(
        { level: 'agency', agencyId: actor.agencyId },
        campaignId,
        soldAt,
        tx,
      );
      const customer = await repo.saveCustomer(
        tx,
        scope,
        campaignId,
        actor.id,
        customerInput(body.customer, version.rules.customer_fields),
        soldAt,
      );
      const proof =
        file && (await fileService.store(tx, { actor, kind: 'sale_proof', buffer: file.buffer }));
      const sale = await repo.createSale(tx, scope, {
        campaignId,
        assignmentId: assignment.id,
        pointOfSaleId,
        animateurId: actor.id,
        supervisorId,
        customerId: customer?.id,
        ruleSetId: version.id,
        soldAt,
        workDate: dateValue(date),
        invoiceRef: body.invoiceRef,
        proofFileId: proof?.id,
        items: { create: items.map((item) => ({ ...item, agencyId: actor.agencyId })) },
      });
      const skippedPromotions = [];
      const shortages = [];
      const delivery = [];
      const promotions = new Map(version.promotions.map((promotion) => [promotion.id, promotion]));
      const gifts = evaluatePromotions(version.promotions, items).sort((a, b) =>
        a.stockItemId.localeCompare(b.stockItemId),
      );
      const eligible = [];
      for (const { tierId, promotionId, ...gift } of gifts) {
        const promotion = promotions.get(promotionId);
        if (
          customer &&
          promotion.maxPerCustomer != null &&
          (await repo.entitlementCount(tx, scope, campaignId, customer.id, promotionId)) >=
            promotion.maxPerCustomer
        ) {
          skippedPromotions.push({ promotionId, code: 'CUSTOMER_LIMIT_REACHED' });
          continue;
        }
        eligible.push(
          await repo.createEntitlement(tx, scope, {
            ...gift,
            campaignId,
            saleId: sale.id,
            promotionId,
            promotionTierId: tierId,
          }),
        );
      }
      await lockDistributionBalances(tx, actor, assignment.campaign, eligible);
      for (const row of eligible) {
        const result = await distribute(tx, { actor, giftEntitlementId: row.id });
        delivery.push({ entitlementId: row.id, ...result });
        if (!result.ok) shortages.push(row);
      }
      for (const row of shortages) {
        const issueId = await issueService.openShortage(tx, actor, assignment, row.stockItemId);
        const linked = await repo.markShortage(tx, scope, row.id, issueId);
        if (linked.count !== 1)
          throw new Error('Expected one pending entitlement to link to the shortage');
        events.emit(tx, 'entitlement.undelivered', {
          agencyId: actor.agencyId,
          actorId: actor.id,
          campaignId,
          saleId: sale.id,
          entitlementId: row.id,
          supervisorId,
          issueId,
        });
      }
      const entries =
        customer?.phone && customer.consentTombola
          ? await tombolas.issueEntries(tx, scope, sale, customer.id, units(items), soldAt)
          : [];
      events.emit(tx, 'sale.recorded', {
        agencyId: actor.agencyId,
        actorId: actor.id,
        campaignId,
        saleId: sale.id,
      });
      const view = saleView(await repo.sale(tx, scope, sale.id, false));
      return {
        ...view,
        customer: view.customer && { ...view.customer, existing: customer.existing },
        skippedPromotions,
        delivery,
        tombolaEntries: entries,
      };
    },
    { status: 201, transaction: fileService.transaction },
  );
}

export function deliver(req) {
  const { actor, params } = req;
  const scope = ScopeService.resolve(actor);
  return runIdempotent(req, async (tx) => {
    const first = required(await repo.entitlement(tx, scope, params.id));
    await repo.lockCampaign(tx, scope, first.campaignId);
    const sale = required(await repo.lockSale(tx, scope, first.saleId));
    required(sale.animateurId === actor.id);
    const row = required(await repo.entitlement(tx, scope, params.id));
    if (row.status !== 'undelivered')
      throw problem('ENTITLEMENT_NOT_UNDELIVERED', 409, 'Gift is not undelivered');
    const result = await distribute(tx, { actor, giftEntitlementId: row.id });
    if (!result.ok)
      throw problem(result.code, 422, 'Not enough stock at this location', result.details);
    if (row.shortageIssueId)
      await issueService.recordCompletedDelivery(tx, actor, row.shortageIssueId);
    return { id: row.id, status: 'distributed', movementId: result.movementId };
  });
}

export function voidSale(actor, id, reason) {
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    const first = required(await repo.sale(tx, scope, id));
    required(await repo.saleVisible(tx, scope, first));
    if (first.animateurId === actor.id)
      throw problem('FORBIDDEN', 403, 'You cannot void your own sale');
    await repo.lockCampaign(tx, scope, first.campaignId);
    const sale = required(await repo.lockSale(tx, scope, id));
    if (sale.status !== 'recorded')
      throw problem('SALE_ALREADY_VOIDED', 409, 'Sale is already voided');
    const campaign = required(
      await repo.campaign(tx, { level: 'agency', agencyId: scope.agencyId }, sale.campaignId),
    );
    if (!['active', 'suspended', 'completed'].includes(campaign.status)) {
      throw problem('FIELD_ENTRY_NOT_ALLOWED', 422, 'Campaign does not allow sale voids', {
        reason: campaign.status,
      });
    }
    const ids = [...new Set(sale.tombolaEntries.map((entry) => entry.tombolaId))];
    await tombolas.lock(tx, scope, ids);
    for (const tombolaId of ids) {
      if ((await tombolas.tombola(tx, scope, tombolaId)).status === 'drawn') {
        throw problem('TOMBOLA_ALREADY_DRAWN', 409, 'An entry belongs to a drawn Tombola');
      }
    }
    const data = {
      status: 'voided',
      voidedById: actor.id,
      voidedAt: clock.now(),
      voidReason: reason,
    };
    await repo.voidSale(tx, scope, id, data);
    await tombolas.excludeSale(tx, scope, id);
    await auditService.record(tx, {
      actor,
      action: 'sale.voided',
      entityType: 'sale',
      entityId: id,
      before: { status: 'recorded' },
      after: data,
    });
    events.emit(tx, 'sale.voided', {
      agencyId: actor.agencyId,
      actorId: actor.id,
      campaignId: sale.campaignId,
      saleId: id,
    });
    return saleView(await repo.sale(tx, scope, id));
  });
}

export function recordInteraction(req) {
  const { actor, params, body } = req;
  const scope = ScopeService.resolve(actor);
  const recordedAt = clock.now();
  const date = businessDate(recordedAt);
  return runIdempotent(
    req,
    async (tx) => {
      const row = await fieldAssignment(tx, scope, actor, params.id, date);
      const interaction = await repo.addInteraction(tx, scope, {
        ...body,
        recordedAt,
        workDate: dateValue(date),
        assignmentId: row.id,
        campaignId: row.campaignId,
        pointOfSaleId: row.pointOfSaleId,
        animateurId: actor.id,
        createdById: actor.id,
      });
      return { ...interaction, workDate: date };
    },
    { status: 201 },
  );
}

export async function detail(actor, id) {
  const scope = ScopeService.resolve(actor);
  const sale = required(await repo.sale(prisma, scope, id));
  required(await repo.saleVisible(prisma, scope, sale));
  return saleView(sale);
}

async function visibleSales(actor, campaignId, filter = {}) {
  const scope = ScopeService.resolve(actor);
  const ownership =
    scope.level === 'supervisor'
      ? { supervisorId: scope.userId }
      : scope.level === 'self'
        ? { animateurId: scope.userId }
        : {};
  const rows = await repo.sales(prisma, scope, { AND: [{ campaignId, ...filter }, ownership] });
  const visible = [];
  const decisions = new Map();
  for (const row of rows) {
    const key = row.supervisorId + ':' + row.workDate.toISOString();
    if (!decisions.has(key)) decisions.set(key, await repo.saleVisible(prisma, scope, row));
    if (decisions.get(key)) visible.push(row);
  }
  if (!visible.length && campaignId) required(await repo.campaign(prisma, scope, campaignId));
  return visible;
}

export async function list(actor, campaignId, filters) {
  const scope = ScopeService.resolve(actor);
  const result = await withTransaction((tx) => repo.salePage(tx, scope, campaignId, filters), {
    isolationLevel: 'RepeatableRead',
  });
  if (!result.total) required(await repo.campaign(prisma, scope, campaignId));
  const { page, pageSize } = filters;
  return {
    data: result.rows.map(saleView),
    meta: {
      page,
      pageSize,
      total: result.total,
      counts: result.counts,
      filters: result.filters,
    },
  };
}
export async function review(actor, campaignId) {
  const rows = await visibleSales(actor, campaignId, {
    status: 'voided',
    giftEntitlements: { some: { status: 'distributed' } },
  });
  return rows.map(saleView).map((row) => ({
    ...row,
    entitlements: row.entitlements.filter((gift) => gift.status === 'distributed'),
  }));
}

function groupUndelivered(rows) {
  const grouped = new Map();
  for (const row of rows)
    for (const gift of row.giftEntitlements) {
      if (gift.status !== 'undelivered') continue;
      const key = row.animateurId + ':' + gift.stockItemId;
      const group = grouped.get(key) ?? {
        animateur: row.animateur,
        stockItem: gift.stockItem,
        quantity: 0,
        entitlements: [],
      };
      group.quantity += gift.quantity;
      group.entitlements.push({
        id: gift.id,
        saleId: row.id,
        quantity: gift.quantity,
        shortageIssueId: gift.shortageIssueId,
      });
      grouped.set(key, group);
    }
  return [...grouped.values()];
}

const withUndelivered = { giftEntitlements: { some: { status: 'undelivered' } } };
export async function undelivered(actor, campaignId) {
  return groupUndelivered(await visibleSales(actor, campaignId, withUndelivered));
}
export async function customers(actor, campaignId) {
  const rows = await visibleSales(actor, campaignId);
  const grouped = new Map();
  for (const { customer, status } of rows) {
    if (!customer) continue;
    const current = grouped.get(customer.id) ?? { ...maskedCustomer(customer), sales: 0 };
    if (status === 'recorded') current.sales++;
    grouped.set(customer.id, current);
  }
  return { count: grouped.size, customers: [...grouped.values()] };
}
export function customerDetail(actor, id) {
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    const row = required(await repo.customer(tx, scope, id));
    await auditService.record(tx, {
      actor,
      action: 'customer.personal_data_read',
      entityType: 'customer',
      entityId: id,
      after: { campaignId: row.campaignId },
    });
    return { id, fullName: row.fullName, phone: row.phone, consentTombola: row.consentTombola };
  });
}
export async function today(actor) {
  const scope = ScopeService.resolve(actor);
  const instant = clock.now();
  const date = businessDate(instant);
  const midnight = new Date(date + 'T00:00:00+01:00');
  const [rows, missed, counted, balances, schedule, delivered] = await Promise.all([
    repo.sales(prisma, scope, {
      animateurId: actor.id,
      status: 'recorded',
      workDate: dateValue(date),
    }),
    repo.sales(prisma, scope, { animateurId: actor.id, ...withUndelivered }),
    repo.interactions(prisma, scope, actor.id, dateValue(date)),
    inventoryMine(actor, 'gift'),
    repo.fieldSchedule(prisma, scope, dateValue(date)),
    repo.deliveredToday(prisma, scope, actor.id, midnight, new Date(+midnight + 86_400_000)),
  ]);
  const current = schedule.find((row) => coversDay(row, date));
  let nextAssignmentDate = null;
  const tomorrow = +dateValue(date) + 86_400_000;
  for (const row of schedule) {
    const start = Math.max(tomorrow, +row.startDate);
    for (let offset = 0; offset < 7; offset++) {
      const candidate = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      if (!coversDay(row, candidate)) continue;
      if (!nextAssignmentDate || candidate < nextAssignmentDate) nextAssignmentDate = candidate;
      break;
    }
  }
  let field = null;
  if (current) {
    const { campaign, id, pointOfSale, shiftStart, shiftEnd } = current;
    const catalog = await repo.fieldCatalog(prisma, scope, campaign);
    const rule =
      campaign.status === 'active'
        ? await ruleSetsService.effective(scope, campaign.id, instant).catch((error) => {
            if (error.status === 404) return null;
            throw error;
          })
        : null;
    field = {
      assignmentId: id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      pointOfSale,
      shiftStart: shiftStart?.toISOString().slice(11, 16) ?? null,
      shiftEnd: shiftEnd?.toISOString().slice(11, 16) ?? null,
      closedReason:
        campaign.status !== 'active' ? 'campaign_not_active' : rule ? null : 'rules_unavailable',
      ...catalog,
      promotions: rule?.promotions ?? [],
      customerFields: rule?.rules.customer_fields ?? null,
    };
  }
  return {
    date,
    salesCount: rows.length,
    units: rows.reduce((sum, row) => sum + units(row.items), 0),
    giftsDelivered: delivered._sum.quantity ?? 0,
    field,
    nextAssignmentDate,
    undelivered: groupUndelivered(missed),
    giftBalances: balances.balances,
    interactions: Object.fromEntries(counted.map((row) => [row.kind, row._sum.count])),
  };
}
