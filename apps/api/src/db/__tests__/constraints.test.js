// One block per row of Prompt 02 section 8: the database itself rejects the forbidden state and
// accepts the nearest valid one.
import { BUSINESS_RULE_VIOLATION } from '@fieldflow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../client.js';
import { withTransaction } from '../transaction.js';
import { expectPgError } from './expectPg.js';
import {
  createAgency,
  createAssignment,
  createCampaign,
  createCustomer,
  createFieldContext,
  createMovement,
  createPointOfSale,
  createRuleSet,
  createSale,
  createStockItem,
  createStockLocation,
  createTombola,
  createTombolaEntry,
  day,
  ledgerEntry,
  linkPointOfSale,
} from './factories.js';

const P0001 = 'P0001';

let ctx;
beforeEach(async () => {
  ctx = await createFieldContext();
});

describe('FR-012 / BR-02: reporting lines never overlap, one open line per user', () => {
  const line = (data) =>
    prisma.reportingLine.create({
      data: {
        agencyId: ctx.agency.id,
        userId: ctx.animateur.id,
        managerId: ctx.supervisor.id,
        ...data,
      },
    });

  it('rejects an overlapping period for the same user', async () => {
    await line({ validFrom: day('2026-01-01'), validTo: day('2026-06-01') });
    await expectPgError(line({ validFrom: day('2026-05-01'), validTo: day('2026-07-01') }), {
      code: '23P01',
      constraint: 'reporting_lines_no_overlap',
    });
  });

  it('accepts an adjacent period (transfer = close the line, open a new one)', async () => {
    await line({ validFrom: day('2026-01-01'), validTo: day('2026-06-01') });
    await expect(line({ validFrom: day('2026-06-01'), validTo: null })).resolves.toBeDefined();
  });

  it('rejects a second open line for the same user', async () => {
    await line({ validFrom: day('2026-01-01'), validTo: null });
    await expectPgError(line({ validFrom: day('2027-01-01'), validTo: null }), {
      code: ['23P01', '23505'],
    });
  });

  it('accepts overlapping periods for different users', async () => {
    await line({ validFrom: day('2026-01-01'), validTo: null });
    await expect(
      prisma.reportingLine.create({
        data: {
          agencyId: ctx.agency.id,
          userId: ctx.supervisor.id,
          managerId: ctx.manager.id,
          validFrom: day('2026-01-01'),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe('BR-13 / Q-08: an Animateur cannot have overlapping proposed/approved assignments', () => {
  beforeEach(async () => {
    await createAssignment(ctx, { startDate: day('2026-03-01'), endDate: day('2026-03-10') });
  });

  it('rejects overlapping dates', async () => {
    await expectPgError(
      createAssignment(ctx, {
        status: 'proposed',
        startDate: day('2026-03-10'),
        endDate: day('2026-03-15'),
      }),
      { code: '23P01', constraint: 'assignments_no_overlap' },
    );
  });

  it('rejects overlapping dates in another campaign (one point of sale per day across campaigns)', async () => {
    const other = await createCampaign(ctx.agency.id, ctx.client.id);
    const pos = await createPointOfSale(ctx.agency.id);
    await linkPointOfSale(other, pos.id);
    await expectPgError(
      createAssignment(ctx, {
        campaignId: other.id,
        pointOfSaleId: pos.id,
        startDate: day('2026-03-05'),
        endDate: day('2026-03-06'),
      }),
      { code: '23P01', constraint: 'assignments_no_overlap' },
    );
  });

  it('accepts adjacent dates', async () => {
    await expect(
      createAssignment(ctx, { startDate: day('2026-03-11'), endDate: day('2026-03-20') }),
    ).resolves.toBeDefined();
  });

  it('accepts overlapping dates when one assignment is cancelled or rejected', async () => {
    await expect(
      createAssignment(ctx, {
        status: 'cancelled',
        startDate: day('2026-03-05'),
        endDate: day('2026-03-06'),
      }),
    ).resolves.toBeDefined();
    await expect(
      createAssignment(ctx, {
        status: 'rejected',
        startDate: day('2026-03-05'),
        endDate: day('2026-03-06'),
      }),
    ).resolves.toBeDefined();
  });
});

describe('BR-41: holder, warehouse and in-transit balances are never negative', () => {
  let item;
  const balance = (location, quantity) =>
    prisma.stockBalance.create({
      data: {
        locationId: location.id,
        stockItemId: item.id,
        agencyId: ctx.agency.id,
        locationKind: location.kind,
        quantity,
      },
    });
  const takeOut = (location, quantity) => prisma.$executeRaw`
    UPDATE stock_balances SET quantity = quantity - ${quantity}
    WHERE location_id = ${location.id}::uuid AND stock_item_id = ${item.id}::uuid`;

  beforeEach(async () => {
    item = await createStockItem(ctx.agency.id, ctx.client.id);
  });

  it('rejects moving 5 units out of a holder with a balance of 3', async () => {
    const holder = await createStockLocation(ctx, 'holder', { userId: ctx.animateur.id });
    await balance(holder, 3);
    await expectPgError(takeOut(holder, 5), {
      code: '23514',
      constraint: 'stock_balances_non_negative',
    });
  });

  it('accepts moving 5 units out of a holder with a balance of 5', async () => {
    const holder = await createStockLocation(ctx, 'holder', { userId: ctx.animateur.id });
    await balance(holder, 5);
    await expect(takeOut(holder, 5)).resolves.toBe(1);
  });

  it.each(['warehouse', 'in_transit'])('rejects a negative %s balance', async (kind) => {
    const location = await createStockLocation(ctx, kind);
    await expectPgError(balance(location, -1), {
      code: '23514',
      constraint: 'stock_balances_non_negative',
    });
  });

  it.each(['external', 'customers', 'losses'])(
    'accepts a negative %s balance (counterpart locations)',
    async (kind) => {
      const location = await createStockLocation(ctx, kind);
      await expect(balance(location, -10)).resolves.toBeDefined();
    },
  );
});

describe('BR-40: the stock ledger and the audit log are append-only', () => {
  it('accepts inserts and rejects UPDATE and DELETE on stock_ledger_entries', async () => {
    const item = await createStockItem(ctx.agency.id, ctx.client.id);
    const warehouse = await createStockLocation(ctx, 'warehouse');
    const external = await createStockLocation(ctx, 'external');
    const move = await createMovement(ctx, { from: external, to: warehouse, stockItem: item });
    await prisma.stockLedgerEntry.createMany({
      data: [ledgerEntry(ctx, move, external.id, -5), ledgerEntry(ctx, move, warehouse.id, 5)],
    });
    const where = { movementLineId: move.line.id };

    await expectPgError(prisma.$executeRaw`UPDATE stock_ledger_entries SET quantity_delta = 7`, {
      code: P0001,
      message: /stock_ledger_entries is append-only/,
    });
    await expectPgError(prisma.$executeRaw`DELETE FROM stock_ledger_entries`, {
      code: P0001,
      message: /stock_ledger_entries is append-only/,
    });
    expect(await prisma.stockLedgerEntry.count({ where })).toBe(2);
  });

  it('accepts inserts and rejects UPDATE and DELETE on audit_logs', async () => {
    const log = await prisma.auditLog.create({
      data: {
        agencyId: ctx.agency.id,
        actorType: 'system',
        action: 'test',
        entityType: 'campaign',
        entityId: ctx.campaign.id,
      },
    });
    await expectPgError(
      prisma.auditLog.update({ where: { id: log.id }, data: { action: 'changed' } }),
      {
        code: P0001,
        message: /audit_logs is append-only/,
      },
    );
    await expectPgError(prisma.auditLog.delete({ where: { id: log.id } }), {
      code: P0001,
      message: /audit_logs is append-only/,
    });
  });
});

describe('Double entry: the ledger entries of each movement line sum to zero at commit', () => {
  let move, from, to;
  beforeEach(async () => {
    const item = await createStockItem(ctx.agency.id, ctx.client.id);
    from = await createStockLocation(ctx, 'warehouse');
    to = await createStockLocation(ctx, 'holder', { userId: ctx.animateur.id });
    move = await createMovement(ctx, { from, to, stockItem: item });
  });

  it('rejects entries of −5 / +4 at commit, as a 422 business rule error', async () => {
    const error = await withTransaction(async (tx) => {
      await tx.stockLedgerEntry.create({ data: ledgerEntry(ctx, move, from.id, -5) });
      await tx.stockLedgerEntry.create({ data: ledgerEntry(ctx, move, to.id, 4) });
    }).catch((err) => err);

    expect(error).toMatchObject({ status: 422, code: BUSINESS_RULE_VIOLATION });
    expect(error.details.reason).toMatch(/unbalanced ledger for line/);
    expect(await prisma.stockLedgerEntry.count({ where: { movementLineId: move.line.id } })).toBe(
      0,
    );
  });

  it('accepts entries of −5 / +5', async () => {
    await withTransaction(async (tx) => {
      await tx.stockLedgerEntry.create({ data: ledgerEntry(ctx, move, from.id, -5) });
      await tx.stockLedgerEntry.create({ data: ledgerEntry(ctx, move, to.id, 5) });
    });
    expect(await prisma.stockLedgerEntry.count({ where: { movementLineId: move.line.id } })).toBe(
      2,
    );
  });
});

describe('BR-14: at most one draft rule set per campaign', () => {
  it('rejects a second draft', async () => {
    await createRuleSet(ctx.campaign, { status: 'draft' });
    await expectPgError(createRuleSet(ctx.campaign, { status: 'draft' }), {
      code: '23505',
      constraint: 'rule_sets_one_draft',
    });
  });

  it('accepts a second approved rule set next to a draft', async () => {
    await createRuleSet(ctx.campaign, { status: 'draft' });
    await expect(createRuleSet(ctx.campaign, { status: 'approved' })).resolves.toBeDefined();
  });
});

describe('Q-11: one customer per phone per campaign', () => {
  it('rejects the same phone twice in one campaign', async () => {
    await createCustomer(ctx, { phone: '+213550000001' });
    await expectPgError(createCustomer(ctx, { phone: '+213550000001' }), {
      code: '23505',
      constraint: 'customers_campaign_phone',
    });
  });

  it('accepts the same phone in another campaign, and any number of customers without phone', async () => {
    await createCustomer(ctx, { phone: '+213550000001' });
    const other = await createCampaign(ctx.agency.id, ctx.client.id);
    await expect(
      createCustomer({ ...ctx, campaign: other }, { phone: '+213550000001' }),
    ).resolves.toBeDefined();
    await createCustomer(ctx, { phone: null });
    await expect(createCustomer(ctx, { phone: null })).resolves.toBeDefined();
  });
});

describe('BR-50: entry number unique per tombola', () => {
  it('rejects a duplicate entry number and accepts it in another tombola', async () => {
    const customer = await createCustomer(ctx);
    const first = await createTombola(ctx);
    const second = await createTombola(ctx);
    await createTombolaEntry(ctx, first, customer, { entryNumber: 1 });

    await expectPgError(createTombolaEntry(ctx, first, customer, { entryNumber: 1 }), {
      code: '23505',
      constraint: 'tombola_entries_tombola_id_entry_number_key',
    });
    await expect(
      createTombolaEntry(ctx, second, customer, { entryNumber: 1 }),
    ).resolves.toBeDefined();
  });
});

describe('BR-51: tombola entries and winners are frozen after the draw', () => {
  let tombola, customer, entry, draw, winner;

  /** The draw service's order: draw + winners first, status = 'drawn' last, in one transaction. */
  async function runDraw() {
    return withTransaction(async (tx) => {
      draw = await tx.tombolaDraw.create({
        data: {
          agencyId: ctx.agency.id,
          tombolaId: tombola.id,
          seed: 'seed',
          algorithm: 'sha256-fisher-yates',
          eligibleCount: 1,
          entriesHash: 'hash',
          drawnById: ctx.manager.id,
          drawnAt: new Date(),
        },
      });
      winner = await tx.tombolaWinner.create({
        data: {
          agencyId: ctx.agency.id,
          drawId: draw.id,
          entryId: entry.id,
          rank: 1,
          isReserve: false,
        },
      });
      await tx.tombola.update({ where: { id: tombola.id }, data: { status: 'drawn' } });
    });
  }

  beforeEach(async () => {
    tombola = await createTombola(ctx);
    customer = await createCustomer(ctx);
    entry = await createTombolaEntry(ctx, tombola, customer);
  });

  it('accepts entry changes before the draw and the draw itself', async () => {
    await expect(
      prisma.tombolaEntry.update({
        where: { id: entry.id },
        data: { status: 'excluded', excludedReason: 'voided sale' },
      }),
    ).resolves.toBeDefined();
    await expect(runDraw()).resolves.toBeUndefined();
  });

  it('rejects inserting, updating or deleting entries after the draw', async () => {
    await runDraw();
    await expectPgError(createTombolaEntry(ctx, tombola, customer), {
      code: P0001,
      message: /tombola is drawn/,
    });
    await expectPgError(
      prisma.tombolaEntry.update({ where: { id: entry.id }, data: { status: 'excluded' } }),
      {
        code: P0001,
        message: /tombola is drawn/,
      },
    );
    await expectPgError(
      prisma.$executeRaw`DELETE FROM tombola_entries WHERE id = ${entry.id}::uuid`,
      {
        code: P0001,
        message: /tombola is drawn/,
      },
    );
  });

  it('rejects inserting, re-ranking or deleting winners after the draw', async () => {
    await runDraw();
    await expectPgError(
      prisma.tombolaWinner.create({
        data: {
          agencyId: ctx.agency.id,
          drawId: draw.id,
          entryId: entry.id,
          rank: 2,
          isReserve: true,
        },
      }),
      { code: P0001, message: /tombola is drawn/ },
    );
    await expectPgError(
      prisma.tombolaWinner.update({ where: { id: winner.id }, data: { rank: 5 } }),
      {
        code: P0001,
        message: /tombola is drawn/,
      },
    );
    await expectPgError(prisma.tombolaWinner.delete({ where: { id: winner.id } }), {
      code: P0001,
      message: /tombola is drawn/,
    });
  });

  it('accepts prize delivery tracking on winners after the draw', async () => {
    await runDraw();
    await expect(
      prisma.tombolaWinner.update({
        where: { id: winner.id },
        data: { deliveryStatus: 'delivered', deliveredAt: new Date() },
      }),
    ).resolves.toMatchObject({ deliveryStatus: 'delivered' });
  });
});

describe('BR-15: no new field data on a closed campaign', () => {
  /** One insert per guarded table, as functions so each is started (and awaited) one at a time. */
  async function fieldDataInserts() {
    const assignment = await prisma.assignment.findFirstOrThrow({
      where: { campaignId: ctx.campaign.id },
    });
    const customer = await prisma.customer.findFirstOrThrow({
      where: { campaignId: ctx.campaign.id },
    });
    const tombola = await prisma.tombola.findFirstOrThrow({
      where: { campaignId: ctx.campaign.id },
    });
    const [from, to] = await prisma.stockLocation.findMany({
      where: { campaignId: ctx.campaign.id },
    });
    const base = { agencyId: ctx.agency.id, campaignId: ctx.campaign.id };

    return {
      sales: () => createSale(ctx, { assignmentId: assignment.id }),
      attendance_records: () =>
        prisma.attendanceRecord.create({
          data: {
            ...base,
            assignmentId: assignment.id,
            animateurId: ctx.animateur.id,
            pointOfSaleId: ctx.pointOfSale.id,
            workDate: day('2026-03-02'),
            checkpoint: 'morning',
            ruleSetId: ctx.ruleSet.id,
            isLate: false,
          },
        }),
      stock_movements: () =>
        prisma.stockMovement.create({
          data: {
            ...base,
            type: 'transfer',
            status: 'pending',
            fromLocationId: from.id,
            toLocationId: to.id,
            createdById: ctx.supervisor.id,
          },
        }),
      supervisor_visits: () =>
        prisma.supervisorVisit.create({
          data: { ...base, supervisorId: ctx.supervisor.id, pointOfSaleId: ctx.pointOfSale.id },
        }),
      tombola_entries: () => createTombolaEntry(ctx, tombola, customer),
      issues: () =>
        prisma.issue.create({
          data: {
            ...base,
            category: 'other',
            title: 'Shelf empty',
            reportedById: ctx.supervisor.id,
          },
        }),
    };
  }

  beforeEach(async () => {
    await createAssignment(ctx);
    await createCustomer(ctx);
    await createTombola(ctx);
    await createStockLocation(ctx, 'warehouse');
    await createStockLocation(ctx, 'holder', { userId: ctx.animateur.id });
  });

  it('accepts field data while the campaign is active', async () => {
    for (const [table, insert] of Object.entries(await fieldDataInserts())) {
      await expect(insert(), table).resolves.toBeDefined();
    }
  });

  it('rejects inserts into sales, attendance, stock movements, visits, tombola entries and issues once closed', async () => {
    await prisma.campaign.update({ where: { id: ctx.campaign.id }, data: { status: 'closed' } });
    for (const [table, insert] of Object.entries(await fieldDataInserts())) {
      await expectPgError(insert(), {
        code: P0001,
        message: new RegExp(`INSERT on ${table} rejected: campaign .* is closed`),
      });
    }
  });
});

describe('withTransaction', () => {
  it('rolls back every write when one statement fails', async () => {
    const agency = await createAgency();
    const error = await withTransaction(async (tx) => {
      await tx.client.create({ data: { agencyId: agency.id, name: 'Kept?' } });
      await tx.agency.create({ data: { name: 'dup', code: agency.code } });
    }).catch((err) => err);

    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { constraint: 'agencies_code_key' },
    });
    expect(await prisma.client.count({ where: { agencyId: agency.id } })).toBe(0);
  });

  it('maps exclusion violations to 409 CONFLICT', async () => {
    await createAssignment(ctx);
    const error = await withTransaction((tx) =>
      tx.assignment.create({
        data: {
          agencyId: ctx.agency.id,
          campaignId: ctx.campaign.id,
          animateurId: ctx.animateur.id,
          pointOfSaleId: ctx.pointOfSale.id,
          supervisorId: ctx.supervisor.id,
          proposedById: ctx.manager.id,
          startDate: day('2026-03-02'),
          endDate: day('2026-03-03'),
        },
      }),
    ).catch((err) => err);
    expect(error).toMatchObject({ status: 409, details: { constraint: 'assignments_no_overlap' } });
  });

  it('maps foreign key violations to 422', async () => {
    const error = await withTransaction((tx) =>
      tx.region.create({
        data: { agencyId: '00000000-0000-4000-8000-000000000000', name: 'North', code: 'N' },
      }),
    ).catch((err) => err);
    expect(error).toMatchObject({
      status: 422,
      code: BUSINESS_RULE_VIOLATION,
      details: { constraint: 'regions_agency_id_fkey' },
    });
  });
});
