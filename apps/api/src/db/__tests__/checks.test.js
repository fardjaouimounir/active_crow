// The remaining hand-written constraints (inline CHECKs and uniques Prisma cannot express):
// each one rejects the forbidden row and accepts the nearest valid one.
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client.js';
import { expectPgError } from './expectPg.js';
import {
  createAgency,
  createAssignment,
  createCampaign,
  createClient,
  createFieldContext,
  createGiftEntitlement,
  createMovement,
  createPointOfSale,
  createProduct,
  createSale,
  createStockItem,
  createStockLocation,
  createTombola,
  createUser,
  day,
  ensureWilaya,
  ledgerEntry,
} from './factories.js';

const CHECK = '23514';
const UNIQUE = '23505';

let ctx;
beforeAll(async () => {
  ctx = await createFieldContext();
});

const coords = (latitude, longitude) => ({ latitude, longitude });

describe('identity and geography', () => {
  it('agencies_code_format', async () => {
    await expectPgError(createAgency({ code: 'bad code' }), {
      code: CHECK,
      constraint: 'agencies_code_format',
    });
    await expect(createAgency({ code: 'GOOD-01' })).resolves.toBeDefined();
  });

  it('users_client_role: client accounts and only they have a client_id', async () => {
    await expectPgError(createUser(ctx.agency.id, { role: 'client' }), {
      code: CHECK,
      constraint: 'users_client_role',
    });
    await expectPgError(
      createUser(ctx.agency.id, { role: 'supervisor', clientId: ctx.client.id }),
      {
        code: CHECK,
        constraint: 'users_client_role',
      },
    );
    await expect(
      createUser(ctx.agency.id, { role: 'client', clientId: ctx.client.id }),
    ).resolves.toBeDefined();
  });

  it('users.email is unique regardless of case (citext)', async () => {
    await createUser(ctx.agency.id, { email: 'Same@Example.dz' });
    await expectPgError(createUser(ctx.agency.id, { email: 'same@example.dz' }), {
      code: UNIQUE,
      constraint: 'users_email_key',
    });
  });

  it('wilayas_id_range: 1–69 only', async () => {
    await expectPgError(prisma.wilaya.create({ data: { id: 70, nameAr: 'x', nameEn: 'x' } }), {
      code: CHECK,
      constraint: 'wilayas_id_range',
    });
    await expect(ensureWilaya(69)).resolves.toMatchObject({ id: 69 });
  });

  it('reporting_lines_not_self and reporting_lines_valid_range', async () => {
    const base = { agencyId: ctx.agency.id, userId: ctx.manager.id, validFrom: day('2026-01-01') };
    await expectPgError(
      prisma.reportingLine.create({ data: { ...base, managerId: ctx.manager.id } }),
      {
        code: CHECK,
        constraint: 'reporting_lines_not_self',
      },
    );
    await expectPgError(
      prisma.reportingLine.create({
        data: { ...base, managerId: ctx.supervisor.id, validTo: day('2025-12-31') },
      }),
      { code: CHECK, constraint: 'reporting_lines_valid_range' },
    );
    await expect(
      prisma.reportingLine.create({
        data: { ...base, managerId: ctx.supervisor.id, validTo: day('2026-01-02') },
      }),
    ).resolves.toBeDefined();
  });

  it('points_of_sale_coordinates: both or neither', async () => {
    await expectPgError(createPointOfSale(ctx.agency.id, coords(36.75, null)), {
      code: CHECK,
      constraint: 'points_of_sale_coordinates',
    });
    await expect(createPointOfSale(ctx.agency.id, coords(36.75, 3.06))).resolves.toBeDefined();
  });
});

describe('clients, campaigns, rules and promotions', () => {
  it('clients_agency_name_active: unique name per agency, case-insensitive, ignoring deleted clients', async () => {
    const agency = await createAgency();
    const first = await createClient(agency.id, { name: 'Ifri' });
    await expectPgError(createClient(agency.id, { name: 'IFRI' }), {
      code: UNIQUE,
      constraint: 'clients_agency_name_active',
    });
    await expect(createClient(ctx.agency.id, { name: 'Ifri' })).resolves.toBeDefined();
    await prisma.client.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(createClient(agency.id, { name: 'Ifri' })).resolves.toBeDefined();
  });

  it('campaigns_date_range and campaigns_approver_role', async () => {
    await expectPgError(
      createCampaign(ctx.agency.id, ctx.client.id, {
        startDate: day('2026-05-02'),
        endDate: day('2026-05-01'),
      }),
      { code: CHECK, constraint: 'campaigns_date_range' },
    );
    await expectPgError(
      createCampaign(ctx.agency.id, ctx.client.id, { assignmentApproverRole: 'supervisor' }),
      {
        code: CHECK,
        constraint: 'campaigns_approver_role',
      },
    );
    await expect(
      createCampaign(ctx.agency.id, ctx.client.id, {
        startDate: day('2026-05-01'),
        endDate: day('2026-05-01'),
        assignmentApproverRole: 'general_manager',
      }),
    ).resolves.toBeDefined();
  });

  it('campaign_wilayas_required_non_negative', async () => {
    await ensureWilaya(1);
    await ensureWilaya(2);
    const row = (wilayaId, requiredAnimateurs) =>
      prisma.campaignWilaya.create({
        data: {
          campaignId: ctx.campaign.id,
          wilayaId,
          agencyId: ctx.agency.id,
          requiredAnimateurs,
        },
      });
    await expectPgError(row(1, -1), {
      code: CHECK,
      constraint: 'campaign_wilayas_required_non_negative',
    });
    await expect(row(2, 0)).resolves.toBeDefined();
  });

  describe('promotion tiers', () => {
    let promotion, gift, product;
    const tier = (data) =>
      prisma.promotionTier.create({
        data: {
          agencyId: ctx.agency.id,
          promotionId: promotion.id,
          stockItemId: gift.id,
          minQuantity: 1,
          giftQuantity: 1,
          ...data,
        },
      });

    beforeAll(async () => {
      promotion = await prisma.promotion.create({
        data: {
          agencyId: ctx.agency.id,
          ruleSetId: ctx.ruleSet.id,
          type: 'tiered_gift',
          name: 'Buy more',
        },
      });
      gift = await createStockItem(ctx.agency.id, ctx.client.id);
      product = await createProduct(ctx.agency.id, ctx.client.id);
    });

    it('promotion_tiers_min_quantity_positive and promotion_tiers_gift_quantity_positive', async () => {
      await expectPgError(tier({ minQuantity: 0 }), {
        code: CHECK,
        constraint: 'promotion_tiers_min_quantity_positive',
      });
      await expectPgError(tier({ minQuantity: 2, giftQuantity: 0 }), {
        code: CHECK,
        constraint: 'promotion_tiers_gift_quantity_positive',
      });
    });

    it('promotion_tiers_unique treats "any product" (NULL) tiers as duplicates', async () => {
      await tier({ minQuantity: 3 });
      await expectPgError(tier({ minQuantity: 3 }), {
        code: UNIQUE,
        constraint: 'promotion_tiers_unique',
      });
      await expect(tier({ minQuantity: 3, productId: product.id })).resolves.toBeDefined();
      await expect(tier({ minQuantity: 6 })).resolves.toBeDefined();
    });
  });
});

describe('assignments, attendance and visits', () => {
  it('assignments_date_range', async () => {
    await expectPgError(
      createAssignment(ctx, { startDate: day('2026-04-02'), endDate: day('2026-04-01') }),
      {
        code: CHECK,
        constraint: 'assignments_date_range',
      },
    );
  });

  it('assignments_shift_pair: shift start and end together or not at all', async () => {
    const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00.000Z`);
    await expectPgError(createAssignment(ctx, { status: 'cancelled', shiftStart: time('09:00') }), {
      code: CHECK,
      constraint: 'assignments_shift_pair',
    });
    await expect(
      createAssignment(ctx, {
        status: 'cancelled',
        shiftStart: time('09:00'),
        shiftEnd: time('17:00'),
      }),
    ).resolves.toBeDefined();
  });

  it('assignments_work_days_iso: ISO weekdays 1–7 only', async () => {
    await expectPgError(createAssignment(ctx, { status: 'cancelled', workDays: [0, 1] }), {
      code: CHECK,
      constraint: 'assignments_work_days_iso',
    });
    await expect(
      createAssignment(ctx, { status: 'cancelled', workDays: [1, 2, 3, 4, 6, 7] }),
    ).resolves.toBeDefined();
  });

  it('attendance_records_coordinates and supervisor_visits_coordinates', async () => {
    const assignment = await createAssignment(ctx, {
      startDate: day('2026-08-01'),
      endDate: day('2026-08-31'),
    });
    const attendance = (checkpoint, location) =>
      prisma.attendanceRecord.create({
        data: {
          agencyId: ctx.agency.id,
          assignmentId: assignment.id,
          campaignId: ctx.campaign.id,
          animateurId: ctx.animateur.id,
          pointOfSaleId: ctx.pointOfSale.id,
          workDate: day('2026-08-03'),
          checkpoint,
          ruleSetId: ctx.ruleSet.id,
          isLate: false,
          ...location,
        },
      });
    await expectPgError(attendance('morning', coords(null, 3.06)), {
      code: CHECK,
      constraint: 'attendance_records_coordinates',
    });
    await expect(attendance('morning', coords(36.75, 3.06))).resolves.toBeDefined();

    const visit = (location) =>
      prisma.supervisorVisit.create({
        data: {
          agencyId: ctx.agency.id,
          campaignId: ctx.campaign.id,
          supervisorId: ctx.supervisor.id,
          pointOfSaleId: ctx.pointOfSale.id,
          ...location,
        },
      });
    await expectPgError(visit(coords(36.75, null)), {
      code: CHECK,
      constraint: 'supervisor_visits_coordinates',
    });
    await expect(visit(coords(null, null))).resolves.toBeDefined();
  });
});

describe('sales and entitlements', () => {
  let assignment, product;
  beforeAll(async () => {
    assignment = await createAssignment(ctx, {
      startDate: day('2026-09-01'),
      endDate: day('2026-09-30'),
    });
    product = await createProduct(ctx.agency.id, ctx.client.id);
  });

  it('sales_voided_consistency: voided ⇔ voided_at is set', async () => {
    await expectPgError(createSale(ctx, { assignmentId: assignment.id, status: 'voided' }), {
      code: CHECK,
      constraint: 'sales_voided_consistency',
    });
    await expectPgError(createSale(ctx, { assignmentId: assignment.id, voidedAt: new Date() }), {
      code: CHECK,
      constraint: 'sales_voided_consistency',
    });
    await expect(
      createSale(ctx, { assignmentId: assignment.id, status: 'voided', voidedAt: new Date() }),
    ).resolves.toBeDefined();
  });

  it('sale_items_quantity_positive and gift_entitlements_quantity_positive', async () => {
    const sale = await createSale(ctx, { assignmentId: assignment.id });
    const item = (quantity) =>
      prisma.saleItem.create({
        data: { agencyId: ctx.agency.id, saleId: sale.id, productId: product.id, quantity },
      });
    await expectPgError(item(0), { code: CHECK, constraint: 'sale_items_quantity_positive' });
    await expect(item(2)).resolves.toBeDefined();

    const gift = await createStockItem(ctx.agency.id, ctx.client.id);
    const promotion = await prisma.promotion.create({
      data: {
        agencyId: ctx.agency.id,
        ruleSetId: ctx.ruleSet.id,
        type: 'gift_with_purchase',
        name: 'Mug',
      },
    });
    const promotionTier = await prisma.promotionTier.create({
      data: {
        agencyId: ctx.agency.id,
        promotionId: promotion.id,
        stockItemId: gift.id,
        minQuantity: 1,
        giftQuantity: 1,
      },
    });
    const entitlement = (quantity) =>
      prisma.giftEntitlement.create({
        data: {
          agencyId: ctx.agency.id,
          campaignId: ctx.campaign.id,
          saleId: sale.id,
          promotionId: promotion.id,
          promotionTierId: promotionTier.id,
          stockItemId: gift.id,
          quantity,
        },
      });
    await expectPgError(entitlement(0), {
      code: CHECK,
      constraint: 'gift_entitlements_quantity_positive',
    });
    await expect(entitlement(1)).resolves.toBeDefined();
  });
});

describe('inventory', () => {
  let stock;
  beforeAll(async () => {
    stock = await createFieldContext();
  });

  it('stock_locations_holder_user: holder ⇔ user_id is set', async () => {
    await expectPgError(createStockLocation(stock, 'holder'), {
      code: CHECK,
      constraint: 'stock_locations_holder_user',
    });
    await expectPgError(createStockLocation(stock, 'warehouse', { userId: stock.supervisor.id }), {
      code: CHECK,
      constraint: 'stock_locations_holder_user',
    });
    await expect(
      createStockLocation(stock, 'holder', { userId: stock.supervisor.id }),
    ).resolves.toBeDefined();
  });

  it('stock_locations_unique: one fixed location of each kind per campaign (NULL user counts)', async () => {
    await createStockLocation(stock, 'losses');
    await expectPgError(createStockLocation(stock, 'losses'), {
      code: UNIQUE,
      constraint: 'stock_locations_unique',
    });
    await expect(
      createStockLocation(stock, 'holder', { userId: stock.animateur.id }),
    ).resolves.toBeDefined();
  });

  describe('movements and ledger', () => {
    let warehouse, transit, item;
    beforeAll(async () => {
      warehouse = await createStockLocation(stock, 'warehouse');
      transit = await createStockLocation(stock, 'in_transit');
      item = await createStockItem(stock.agency.id, stock.client.id);
    });

    it('stock_movements_distinct_locations', async () => {
      await expectPgError(
        createMovement(stock, { from: warehouse, to: warehouse, stockItem: item }),
        {
          code: CHECK,
          constraint: 'stock_movements_distinct_locations',
        },
      );
    });

    it('stock_movements_one_per_entitlement: one entitlement, one distribution movement', async () => {
      const holderUser = await createUser(stock.agency.id);
      const holder = await createStockLocation(stock, 'holder', { userId: holderUser.id });
      const customers = await createStockLocation(stock, 'customers');
      const assignment = await createAssignment(stock, {
        startDate: day('2026-10-01'),
        endDate: day('2026-10-31'),
      });
      const sale = await createSale(stock, {
        assignmentId: assignment.id,
        workDate: day('2026-10-02'),
      });
      const [first, second] = [
        await createGiftEntitlement(stock, sale),
        await createGiftEntitlement(stock, sale),
      ];
      const distribute = (entitlement) =>
        createMovement(stock, {
          from: holder,
          to: customers,
          stockItem: item,
          type: 'distribution',
          status: 'posted',
          giftEntitlementId: entitlement.id,
        });

      await distribute(first);
      await expectPgError(distribute(first), {
        code: UNIQUE,
        constraint: 'stock_movements_one_per_entitlement',
      });
      await expect(distribute(second)).resolves.toBeDefined();
    });

    it('stock_movements_distribution_entitlement: distribution ⇔ gift_entitlement_id is set', async () => {
      await expectPgError(
        createMovement(stock, {
          from: warehouse,
          to: transit,
          stockItem: item,
          type: 'distribution',
          status: 'posted',
        }),
        { code: CHECK, constraint: 'stock_movements_distribution_entitlement' },
      );
      await expect(
        createMovement(stock, { from: warehouse, to: transit, stockItem: item }),
      ).resolves.toBeDefined();
    });

    it('stock_movement_lines_quantity_positive and stock_movement_lines_received_range', async () => {
      await expectPgError(
        createMovement(stock, { from: warehouse, to: transit, stockItem: item, quantity: 0 }),
        {
          code: CHECK,
          constraint: 'stock_movement_lines_quantity_positive',
        },
      );
      const { line } = await createMovement(stock, {
        from: warehouse,
        to: transit,
        stockItem: item,
        quantity: 5,
      });
      const receive = (quantityReceived) =>
        prisma.stockMovementLine.update({ where: { id: line.id }, data: { quantityReceived } });
      await expectPgError(receive(6), {
        code: CHECK,
        constraint: 'stock_movement_lines_received_range',
      });
      await expectPgError(receive(-1), {
        code: CHECK,
        constraint: 'stock_movement_lines_received_range',
      });
      await expect(receive(3)).resolves.toMatchObject({ quantityReceived: 3 });
    });

    it('stock_ledger_entries_delta_non_zero', async () => {
      const move = await createMovement(stock, { from: warehouse, to: transit, stockItem: item });
      await expectPgError(
        prisma.stockLedgerEntry.create({ data: ledgerEntry(stock, move, warehouse.id, 0) }),
        { code: CHECK, constraint: 'stock_ledger_entries_delta_non_zero' },
      );
    });
  });
});

describe('tombola', () => {
  it('tombolas_counts: at least one winner, no negative reserves', async () => {
    await expectPgError(createTombola(ctx, { winnersCount: 0 }), {
      code: CHECK,
      constraint: 'tombolas_counts',
    });
    await expectPgError(createTombola(ctx, { reservesCount: -1 }), {
      code: CHECK,
      constraint: 'tombolas_counts',
    });
    await expect(createTombola(ctx, { winnersCount: 3, reservesCount: 0 })).resolves.toBeDefined();
  });
});
