// Minimal row builders for database tests. Test-only: never imported by application code.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../client.js';

let sequence = 0;
const next = () => ++sequence;
export const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

const seedWilayas = JSON.parse(
  readFileSync(new URL('../../../prisma/seed/data/wilayas.json', import.meta.url), 'utf8'),
);

/** Wilayas are reference data (kept between test files); insert the real row if missing. */
export async function ensureWilaya(id = 16) {
  const row = seedWilayas.find((w) => w.id === id);
  return prisma.wilaya.upsert({ where: { id }, create: row, update: {} });
}

export function createAgency(data = {}) {
  return prisma.agency.create({ data: { name: 'Test agency', code: `AG-${next()}`, ...data } });
}

export function createClient(agencyId, data = {}) {
  return prisma.client.create({ data: { agencyId, name: `Client ${next()}`, ...data } });
}

export function createUser(agencyId, data = {}) {
  return prisma.user.create({
    data: {
      agencyId,
      role: 'animateur',
      fullName: `User ${next()}`,
      email: `user-${randomUUID()}@test.local`,
      passwordHash: 'not-a-real-hash',
      ...data,
    },
  });
}

export function createCampaign(agencyId, clientId, data = {}) {
  return prisma.campaign.create({
    data: {
      agencyId,
      clientId,
      code: `CMP-${next()}`,
      name: 'Test campaign',
      startDate: day('2026-01-01'),
      endDate: day('2026-12-31'),
      status: 'active',
      ...data,
    },
  });
}

export async function createPointOfSale(agencyId, data = {}) {
  await ensureWilaya(16);
  return prisma.pointOfSale.create({
    data: {
      agencyId,
      code: `POS-${next()}`,
      name: 'Test store',
      type: 'supermarket',
      wilayaId: 16,
      ...data,
    },
  });
}

export function linkPointOfSale(campaign, pointOfSaleId) {
  return prisma.campaignPointOfSale.create({
    data: { campaignId: campaign.id, pointOfSaleId, agencyId: campaign.agencyId },
  });
}

export function createRuleSet(campaign, data = {}) {
  return prisma.ruleSet.create({
    data: { agencyId: campaign.agencyId, campaignId: campaign.id, version: next(), ...data },
  });
}

export function createProduct(agencyId, clientId, data = {}) {
  return prisma.product.create({
    data: { agencyId, clientId, sku: `P-${next()}`, name: 'Product', unitLabel: 'unit', ...data },
  });
}

export function createStockItem(agencyId, clientId, data = {}) {
  return prisma.stockItem.create({
    data: {
      agencyId,
      clientId,
      kind: 'gift',
      sku: `G-${next()}`,
      name: 'Gift',
      unitLabel: 'unit',
      ...data,
    },
  });
}

/**
 * One campaign with its people and a linked point of sale: the smallest world most tests need.
 * @param {{ campaign?: object }} [options]
 */
export async function createFieldContext({ campaign: campaignData = {} } = {}) {
  const agency = await createAgency();
  const client = await createClient(agency.id);
  const campaign = await createCampaign(agency.id, client.id, campaignData);
  const [animateur, supervisor, manager] = await Promise.all([
    createUser(agency.id, { role: 'animateur' }),
    createUser(agency.id, { role: 'supervisor' }),
    createUser(agency.id, { role: 'regional_manager' }),
  ]);
  const pointOfSale = await createPointOfSale(agency.id);
  await linkPointOfSale(campaign, pointOfSale.id);
  const ruleSet = await createRuleSet(campaign, { status: 'approved' });
  return { agency, client, campaign, animateur, supervisor, manager, pointOfSale, ruleSet };
}

export function createAssignment(ctx, data = {}) {
  return prisma.assignment.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      animateurId: ctx.animateur.id,
      pointOfSaleId: ctx.pointOfSale.id,
      supervisorId: ctx.supervisor.id,
      proposedById: ctx.manager.id,
      startDate: day('2026-03-01'),
      endDate: day('2026-03-10'),
      status: 'approved',
      ...data,
    },
  });
}

export function createCustomer(ctx, data = {}) {
  return prisma.customer.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      createdById: ctx.animateur.id,
      ...data,
    },
  });
}

/** @param {object} ctx @param {{ assignmentId: string } & object} data */
export function createSale(ctx, data) {
  return prisma.sale.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      pointOfSaleId: ctx.pointOfSale.id,
      animateurId: ctx.animateur.id,
      supervisorId: ctx.supervisor.id,
      ruleSetId: ctx.ruleSet.id,
      workDate: day('2026-03-02'),
      ...data,
    },
  });
}

/** An entitlement of 1 × a new gift for `sale`, through its own promotion and tier. */
export async function createGiftEntitlement(ctx, sale) {
  const gift = await createStockItem(ctx.agency.id, ctx.client.id);
  const promotion = await prisma.promotion.create({
    data: {
      agencyId: ctx.agency.id,
      ruleSetId: ctx.ruleSet.id,
      type: 'gift_with_purchase',
      name: `Promotion ${next()}`,
    },
  });
  const tier = await prisma.promotionTier.create({
    data: {
      agencyId: ctx.agency.id,
      promotionId: promotion.id,
      stockItemId: gift.id,
      minQuantity: 1,
      giftQuantity: 1,
    },
  });
  return prisma.giftEntitlement.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      saleId: sale.id,
      promotionId: promotion.id,
      promotionTierId: tier.id,
      stockItemId: gift.id,
      quantity: 1,
    },
  });
}

export function createTombola(ctx, data = {}) {
  return prisma.tombola.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      name: `Tombola ${next()}`,
      entryBasis: 'per_sale',
      entriesPerBasis: 1,
      requiresPurchase: true,
      registrationEndsAt: new Date('2026-06-01T00:00:00Z'),
      drawScheduledAt: new Date('2026-06-02T00:00:00Z'),
      winnersCount: 1,
      reservesCount: 1,
      ...data,
    },
  });
}

export function createTombolaEntry(ctx, tombola, customer, data = {}) {
  return prisma.tombolaEntry.create({
    data: {
      agencyId: ctx.agency.id,
      tombolaId: tombola.id,
      customerId: customer.id,
      entryNumber: next(),
      ...data,
    },
  });
}

export function createStockLocation(ctx, kind, data = {}) {
  return prisma.stockLocation.create({
    data: { agencyId: ctx.agency.id, campaignId: ctx.campaign.id, kind, ...data },
  });
}

/** A movement with one line of `quantity` units of `stockItem`. */
export async function createMovement(ctx, { from, to, stockItem, quantity = 5, ...data }) {
  const movement = await prisma.stockMovement.create({
    data: {
      agencyId: ctx.agency.id,
      campaignId: ctx.campaign.id,
      type: 'transfer',
      status: 'pending',
      fromLocationId: from.id,
      toLocationId: to.id,
      createdById: ctx.supervisor.id,
      ...data,
    },
  });
  const line = await prisma.stockMovementLine.create({
    data: { agencyId: ctx.agency.id, movementId: movement.id, stockItemId: stockItem.id, quantity },
  });
  return { movement, line };
}

/** Data for one stock_ledger_entries row of `line`. */
export function ledgerEntry(ctx, { movement, line }, locationId, quantityDelta) {
  return {
    agencyId: ctx.agency.id,
    campaignId: ctx.campaign.id,
    movementId: movement.id,
    movementLineId: line.id,
    locationId,
    stockItemId: line.stockItemId,
    quantityDelta,
  };
}
