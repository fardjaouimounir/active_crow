import { entriesHash, verifyDraw } from '@fieldflow/shared';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';
import { createTombola } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { createStockWorld, root } from '../../inventory/__tests__/helpers.js';

const app = createApp();
let world;
let otherClientAuth;
let sequence = 0;

beforeAll(async () => {
  world = await createStockWorld(app);
  const other = await createUserWithPassword(world.agency.id, {
    role: 'client',
    clientId: world.otherClient.id,
  });
  otherClientAuth = bearer((await login(app, other)).accessToken);
});

const prizes = (count) =>
  Array.from({ length: count }, (_, index) => ({ rank: index + 1, label: `Prize ${index + 1}` }));
const call = (actor, method, path, body) => {
  const req = request(app)[method](root + path);
  const auth = typeof actor === 'string' ? world.auth[actor] : actor;
  if (auth) req.set(auth);
  return body === undefined ? req : req.send(body);
};

/**
 * An active campaign of the world client with an open Tombola holding `entries` valid entries
 * numbered 1..entries (plus one excluded entry that must never be eligible).
 */
async function setup({ entries = 20, winnersCount = 3, reservesCount = 2, close = true } = {}) {
  const built = await world.campaign();
  const ctx = { agency: world.agency, campaign: built.campaign, animateur: built.animateur };
  const tombola = await createTombola(ctx, { winnersCount, reservesCount });
  const customers = [];
  for (let i = 1; i <= entries + 1; i++) {
    sequence += 1;
    customers.push(
      await prisma.customer.create({
        data: {
          agencyId: world.agency.id,
          campaignId: built.campaign.id,
          createdById: built.animateur.id,
          fullName: `Karim Haddad ${sequence}`,
          phone: `+213550${String(sequence).padStart(6, '0')}`,
        },
      }),
    );
  }
  await prisma.tombolaEntry.createMany({
    data: customers.map((customer, index) => ({
      agencyId: world.agency.id,
      tombolaId: tombola.id,
      customerId: customer.id,
      entryNumber: index + 1,
      ...(index === entries ? { status: 'excluded', excludedReason: 'sale_voided' } : {}),
    })),
  });
  if (close) await world.ok(call('director', 'post', `/tombolas/${tombola.id}/close`, {}));
  return { built, tombola, customers };
}

const draw = (actor, id, body = { prizes: prizes(3), clientNonce: 'ramadan' }) =>
  call(actor, 'post', `/tombolas/${id}/draw`, body);

describe('commitment (BR-52)', () => {
  it('closing registration commits to the valid entries, excluded ones left out', async () => {
    const { tombola } = await setup({ entries: 12, close: false });
    const before = await world.ok(call('clientUser', 'get', `/tombolas/${tombola.id}`));
    expect(before.commitment).toBeNull();
    await world.ok(call('director', 'post', `/tombolas/${tombola.id}/close`, {}));
    const after = await world.ok(call('clientUser', 'get', `/tombolas/${tombola.id}`));
    const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(after.commitment).toMatchObject({
      entriesHash: await entriesHash(numbers),
      eligibleCount: 12,
      committedAt: expect.any(String),
    });
    expect(after.entryCount).toBe(12);
  });

  it('the database refuses to change entries or the commitment once registration is closed', async () => {
    const { tombola } = await setup({ entries: 5 });
    await expect(
      prisma.tombolaEntry.update({
        where: { tombolaId_entryNumber: { tombolaId: tombola.id, entryNumber: 1 } },
        data: { status: 'excluded' },
      }),
    ).rejects.toThrow(/registration is closed/);
    await expect(
      prisma.tombola.update({ where: { id: tombola.id }, data: { entriesHash: 'forged' } }),
    ).rejects.toThrow(/commitment cannot change/);
    await expect(
      prisma.tombola.update({ where: { id: tombola.id }, data: { status: 'open' } }),
    ).rejects.toThrow(/Invalid tombola status change/);
  });

  it('a sale with entries in a closed Tombola can no longer be voided', async () => {
    const { tombola, built } = await setup({ entries: 3, close: false });
    const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: built.id } });
    const sale = await prisma.sale.create({
      data: {
        agencyId: world.agency.id,
        campaignId: built.id,
        assignmentId: built.assignment.id,
        pointOfSaleId: built.pointOfSale.id,
        animateurId: built.animateur.id,
        supervisorId: world.people.supervisor.id,
        ruleSetId: ruleSet.id,
        workDate: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    await prisma.tombolaEntry.updateMany({
      where: { tombolaId: tombola.id, entryNumber: 1 },
      data: { saleId: sale.id },
    });
    await world.ok(call('director', 'post', `/tombolas/${tombola.id}/close`, {}));
    await world.refused(
      call('director', 'post', `/sales/${sale.id}/void`, { reason: 'mistake' }),
      409,
      'TOMBOLA_ENTRIES_FROZEN',
    );
  });
});

describe('POST /tombolas/:id/draw (FR-092, BR-51)', () => {
  it('who may draw: the client of the campaign or the director, nobody else', async () => {
    const { tombola } = await setup();
    await world.refused(draw(otherClientAuth, tombola.id), 404, 'NOT_FOUND');
    await world.refused(draw('supervisor', tombola.id), 403, 'FORBIDDEN');
    await world.refused(draw('general', tombola.id), 403, 'FORBIDDEN');
    await world.refused(draw('animateur', tombola.id), 403, 'FORBIDDEN');
    await world.refused(draw(null, tombola.id), 401, 'UNAUTHENTICATED');
    expect((await prisma.tombolaDraw.count({ where: { tombolaId: tombola.id } })) === 0).toBe(true);
  });

  it('refuses a Tombola that is not closed', async () => {
    const { tombola } = await setup({ close: false });
    await world.refused(draw('clientUser', tombola.id), 409, 'TOMBOLA_NOT_CLOSED');
  });

  it('validates the body: one prize label per winner rank', async () => {
    const { tombola } = await setup();
    await world.refused(
      draw('clientUser', tombola.id, { prizes: prizes(2) }),
      400,
      'VALIDATION_FAILED',
    );
    await world.refused(
      draw('clientUser', tombola.id, { prizes: prizes(3), clientNonce: 'x'.repeat(65) }),
      400,
      'VALIDATION_FAILED',
    );
    await world.refused(draw('clientUser', tombola.id, { prizes: [] }), 400, 'VALIDATION_FAILED');
  });

  it('NOT_ENOUGH_ENTRIES when there are fewer eligible entries than winners', async () => {
    const { tombola } = await setup({ entries: 2 });
    await world.refused(draw('clientUser', tombola.id), 422, 'NOT_ENOUGH_ENTRIES');
  });

  it('the client draws once; the result verifies; a tampered copy does not', async () => {
    const { tombola } = await setup({ entries: 30 });
    const drawn = await world.ok(draw('clientUser', tombola.id), 201);
    expect(drawn).toMatchObject({
      status: 'drawn',
      draw: { algorithm: 'hmac-sha256-fisher-yates-v1', eligibleCount: 30 },
    });
    expect(drawn.draw.drawnBy).toEqual({ kind: 'client', name: world.people.clientUser.fullName });
    await world.refused(draw('clientUser', tombola.id), 409, 'TOMBOLA_ALREADY_DRAWN');
    await world.refused(draw('director', tombola.id), 409, 'TOMBOLA_ALREADY_DRAWN');

    const data = await world.ok(
      call('clientUser', 'get', `/tombolas/${tombola.id}/draw/verification`),
    );
    expect(data).toMatchObject({ clientNonce: 'ramadan', winnersCount: 3, reservesCount: 2 });
    expect(data.serverRandom).toMatch(/^[0-9a-f]{64}$/);
    expect(data.winners).toHaveLength(3);
    expect(data.reserves).toHaveLength(2);
    expect(data.entryNumbers).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect((await verifyDraw(data)).ok).toBe(true);
    expect((await verifyDraw({ ...data, winners: [...data.winners].reverse() })).ok).toBe(false);
    expect((await verifyDraw({ ...data, clientNonce: 'forged' })).ok).toBe(false);

    const winners = await world.ok(call('clientUser', 'get', `/tombolas/${tombola.id}/winners`));
    expect(winners.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5]);
    expect(winners.filter(({ isReserve }) => isReserve)).toHaveLength(2);
    expect(winners[0].prizeLabel).toBe('Prize 1');
  });

  it('the director can draw on behalf of the client and the portal shows it was the agency', async () => {
    const { tombola } = await setup({ winnersCount: 1, reservesCount: 1 });
    const drawn = await world.ok(draw('director', tombola.id, { prizes: prizes(1) }), 201);
    expect(drawn.draw.drawnBy).toEqual({ kind: 'agency', name: null });
    const row = await prisma.tombolaDraw.findUniqueOrThrow({ where: { tombolaId: tombola.id } });
    expect(row.drawnById).toBe(world.people.director.id);
    expect(row.clientNonce).toBe('');
  });

  it('never draws when the entry list differs from the commitment', async () => {
    const { tombola } = await setup({ entries: 10 });
    // Tamper inside one transaction with the guard switched off (only possible for the table owner).
    await prisma.$transaction([
      prisma.$executeRaw`ALTER TABLE tombola_entries DISABLE TRIGGER tombola_entries_frozen`,
      prisma.$executeRaw`UPDATE tombola_entries SET status = 'excluded'
        WHERE tombola_id = ${tombola.id}::uuid AND entry_number = 4`,
      prisma.$executeRaw`ALTER TABLE tombola_entries ENABLE TRIGGER tombola_entries_frozen`,
    ]);
    const res = await draw('clientUser', tombola.id);
    expect(res.status).toBe(500);
    expect(await prisma.tombolaDraw.count({ where: { tombolaId: tombola.id } })).toBe(0);
    expect((await prisma.tombola.findUniqueOrThrow({ where: { id: tombola.id } })).status).toBe(
      'closed',
    );
  });

  it('two simultaneous draws produce exactly one draw', async () => {
    const { tombola } = await setup({ entries: 15 });
    const results = await Promise.all([
      draw('clientUser', tombola.id),
      draw('director', tombola.id),
      draw('clientUser', tombola.id),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.tombolaDraw.count({ where: { tombolaId: tombola.id } })).toBe(1);
    expect(await prisma.tombolaWinner.count({ where: { draw: { tombolaId: tombola.id } } })).toBe(
      5,
    );
  });

  it('after the draw the database refuses entry edits, winner changes and a second draw', async () => {
    const { tombola } = await setup({ entries: 10 });
    await world.ok(draw('clientUser', tombola.id), 201);
    await expect(
      prisma.tombolaEntry.update({
        where: { tombolaId_entryNumber: { tombolaId: tombola.id, entryNumber: 2 } },
        data: { status: 'excluded' },
      }),
    ).rejects.toThrow(/tombola is drawn/);
    const row = await prisma.tombolaDraw.findUniqueOrThrow({ where: { tombolaId: tombola.id } });
    await expect(
      prisma.tombolaWinner.updateMany({ where: { drawId: row.id, rank: 1 }, data: { rank: 9 } }),
    ).rejects.toThrow(/tombola is drawn/);
    await expect(
      prisma.tombolaDraw.create({
        data: {
          agencyId: world.agency.id,
          tombolaId: tombola.id,
          seed: 's',
          algorithm: 'x',
          eligibleCount: 1,
          entriesHash: 'h',
          drawnById: world.people.director.id,
          drawnAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('the draw row and the Tombola status are frozen by the database after the draw', async () => {
    const { tombola } = await setup({ entries: 6 });
    await world.ok(draw('clientUser', tombola.id), 201);
    const row = await prisma.tombolaDraw.findUniqueOrThrow({ where: { tombolaId: tombola.id } });
    await expect(
      prisma.tombolaDraw.update({ where: { id: row.id }, data: { serverRandom: 'forged' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.tombolaDraw.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.tombola.update({ where: { id: tombola.id }, data: { status: 'closed' } }),
    ).rejects.toThrow(/Invalid tombola status change/);
  });

  it('a Tombola cannot skip the commitment: open to drawn is refused', async () => {
    const { tombola } = await setup({ entries: 3, close: false });
    await expect(
      prisma.tombola.update({ where: { id: tombola.id }, data: { status: 'drawn' } }),
    ).rejects.toThrow(/Invalid tombola status change/);
  });

  it('a draw whose list differs from the commitment is rejected by the database itself', async () => {
    const { tombola } = await setup({ entries: 6 });
    await expect(
      prisma.tombolaDraw.create({
        data: {
          agencyId: world.agency.id,
          tombolaId: tombola.id,
          seed: 's',
          algorithm: 'x',
          eligibleCount: 6,
          entriesHash: 'not-the-commitment',
          drawnById: world.people.director.id,
          drawnAt: new Date(),
        },
      }),
    ).rejects.toThrow(/committed entry list/);
  });
});

describe('winners and prize delivery (E-15)', () => {
  async function drawn(options) {
    const made = await setup({ entries: 20, ...options });
    await world.ok(draw('clientUser', made.tombola.id), 201);
    const list = await world.ok(call('director', 'get', `/tombolas/${made.tombola.id}/winners`));
    return { ...made, list };
  }

  it('masks contacts for the client, shows them to the director only on an audited request', async () => {
    const { tombola, customers } = await drawn();
    const masked = await world.ok(call('clientUser', 'get', `/tombolas/${tombola.id}/winners`));
    const text = JSON.stringify(masked);
    for (const customer of customers) {
      expect(text).not.toContain(customer.phone);
      expect(text).not.toContain(customer.fullName);
    }
    expect(masked[0].customer.phone).toMatch(/•/);
    await world.refused(
      call('clientUser', 'get', `/tombolas/${tombola.id}/winners?personal=true`),
      404,
      'NOT_FOUND',
    );
    const full = await world.ok(
      call('director', 'get', `/tombolas/${tombola.id}/winners?personal=true`),
    );
    expect(full[0].customer.phone).toMatch(/^\+213550/);
    expect(
      await prisma.auditLog.count({
        where: { entityId: tombola.id, action: 'tombola.winners_personal_read' },
      }),
    ).toBe(1);
    // The default director read is masked and not audited as a personal read.
    expect(
      (await world.ok(call('director', 'get', `/tombolas/${tombola.id}/winners`)))[0].customer
        .phone,
    ).toMatch(/•/);
  });

  it('unreachable winner 2 promotes the first unused reserve to rank 2, winner 1 is delivered', async () => {
    const { tombola, list } = await drawn();
    const [one, two] = list;
    const firstReserve = list.find(({ isReserve }) => isReserve);
    await world.refused(
      call('clientUser', 'post', `/tombolas/${tombola.id}/winners/${two.id}/unreachable`, {
        reason: 'x',
      }),
      403,
      'FORBIDDEN',
    );
    await world.refused(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${two.id}/unreachable`, {}),
      400,
      'VALIDATION_FAILED',
    );
    const result = await world.ok(
      call('general', 'post', `/tombolas/${tombola.id}/winners/${two.id}/unreachable`, {
        reason: 'Phone off for three days',
      }),
    );
    expect(result).toMatchObject({
      deliveryStatus: 'unreachable',
      promotedReserveId: firstReserve.id,
    });
    const after = await world.ok(call('director', 'get', `/tombolas/${tombola.id}/winners`));
    expect(after.find(({ id }) => id === two.id)).toMatchObject({
      deliveryStatus: 'unreachable',
      unreachableReason: 'Phone off for three days',
    });
    expect(after.find(({ id }) => id === firstReserve.id)).toMatchObject({
      servesRank: 2,
      prizeLabel: 'Prize 2',
    });
    expect(
      await prisma.auditLog.count({
        where: { entityId: two.id, action: 'tombola.winner_unreachable' },
      }),
    ).toBe(1);

    await world.ok(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${one.id}/delivered`, {}),
    );
    await world.refused(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${one.id}/delivered`, {}),
      409,
      'WINNER_ALREADY_FINAL',
    );
    await world.refused(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${two.id}/unreachable`, {
        reason: 'again',
      }),
      409,
      'WINNER_ALREADY_FINAL',
    );
    // The promoted reserve can receive the prize; the idle one cannot.
    await world.ok(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${firstReserve.id}/delivered`, {}),
    );
    const idle = list.filter(({ isReserve }) => isReserve)[1];
    await world.refused(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${idle.id}/delivered`, {}),
      422,
      'BUSINESS_RULE_VIOLATION',
    );
  });

  it('NO_RESERVE_LEFT once the reserves are used up; the winner stays pending', async () => {
    const { tombola, list } = await drawn({ winnersCount: 3, reservesCount: 1 });
    const [one, two, three] = list;
    await world.ok(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${one.id}/unreachable`, {
        reason: 'a',
      }),
    );
    await world.refused(
      call('director', 'post', `/tombolas/${tombola.id}/winners/${two.id}/unreachable`, {
        reason: 'b',
      }),
      422,
      'NO_RESERVE_LEFT',
    );
    expect(
      (await prisma.tombolaWinner.findUniqueOrThrow({ where: { id: two.id } })).deliveryStatus,
    ).toBe('pending');
    expect(three.deliveryStatus).toBe('pending');
  });
});
