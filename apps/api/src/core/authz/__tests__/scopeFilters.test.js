// docs/01 §2.3 data scope. Fixture (agency 1):
//
//   R1 (regional) ── staffed on C1 (wilaya 16)        R2 (regional) ── staffed on C2 (wilaya 31)
//    ├─ S1 (supervisor, staffed on C1)                  └─ S3 (supervisor, staffed on C2)
//    │   ├─ A1  approved assignment C1, supervisor S1        ├─ A3  proposed assignment C2, supervisor S3
//    │   └─ A5  until 2026-03-15 ─┐ (transfer)               ├─ A4  approved assignment C2, supervisor S3
//    └─ S2 (supervisor, not staffed)                         └─ A6  no assignment
//        ├─ A2  approved assignment C1, supervisor S2
//        └─ A5  from 2026-03-15 ──┘
//
//   Client user CU belongs to client X (C1); C2 belongs to client Y. Agency 2 has its own world.
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../db/client.js';
import {
  createAgency,
  createCampaign,
  createClient,
  createPointOfSale,
  createUser,
  day,
  ensureWilaya,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import {
  REPORTING_TREE_MAX_DEPTH,
  SYSTEM_SCOPE,
  ScopeService,
  campaignWhere,
  scoped,
  userWhere,
} from '../index.js';

const BEFORE_TRANSFER = '2026-03-01';
const TRANSFER_DAY = '2026-03-15';
const AFTER_TRANSFER = '2026-04-01';

let w; // the world: users and campaigns by short name
let other; // agency 2

const actorOf = (user) =>
  Object.freeze({
    type: 'user',
    id: user.id,
    agencyId: user.agencyId,
    role: user.role,
    clientId: user.clientId,
    mustChangePassword: false,
  });
const scopeOf = (user) => ScopeService.resolve(actorOf(user));
const ids = (...names) => names.map((name) => w[name].id).sort();

async function campaignIds(scope) {
  const rows = await prisma.campaign.findMany({
    where: campaignWhere(scope),
    select: { id: true },
  });
  return rows.map((row) => row.id).sort();
}
async function userIds(scope, at) {
  const rows = await prisma.user.findMany({
    where: await userWhere(scope, { at }),
    select: { id: true },
  });
  return rows.map((row) => row.id).sort();
}

async function line(agencyId, user, manager, validFrom, validTo = null) {
  return prisma.reportingLine.create({
    data: {
      agencyId,
      userId: user.id,
      managerId: manager.id,
      validFrom: day(validFrom),
      validTo: validTo && day(validTo),
    },
  });
}

async function buildWorld() {
  await Promise.all([ensureWilaya(16), ensureWilaya(31)]);
  const agency = await createAgency();
  const a = agency.id;
  const clientX = await createClient(a);
  const clientY = await createClient(a);

  const people = {};
  const roles = {
    D: 'director',
    GM: 'general_manager',
    R1: 'regional_manager',
    R2: 'regional_manager',
    S1: 'supervisor',
    S2: 'supervisor',
    S3: 'supervisor',
    A1: 'animateur',
    A2: 'animateur',
    A3: 'animateur',
    A4: 'animateur',
    A5: 'animateur',
    A6: 'animateur',
  };
  for (const [name, role] of Object.entries(roles)) {
    people[name] = await createUser(a, { role, fullName: name });
  }
  people.CU = await createUser(a, { role: 'client', clientId: clientX.id, fullName: 'CU' });

  const C1 = await createCampaign(a, clientX.id, { name: 'C1' });
  const C2 = await createCampaign(a, clientY.id, { name: 'C2' });
  await prisma.campaignWilaya.createMany({
    data: [
      { campaignId: C1.id, wilayaId: 16, agencyId: a },
      { campaignId: C2.id, wilayaId: 31, agencyId: a },
    ],
  });
  await prisma.campaignStaff.createMany({
    data: [
      {
        agencyId: a,
        campaignId: C1.id,
        wilayaId: 16,
        userId: people.R1.id,
        role: 'regional_manager',
      },
      { agencyId: a, campaignId: C1.id, wilayaId: 16, userId: people.S1.id, role: 'supervisor' },
      {
        agencyId: a,
        campaignId: C2.id,
        wilayaId: 31,
        userId: people.R2.id,
        role: 'regional_manager',
      },
      { agencyId: a, campaignId: C2.id, wilayaId: 31, userId: people.S3.id, role: 'supervisor' },
    ],
  });

  const pos1 = await createPointOfSale(a);
  const pos2 = await createPointOfSale(a);
  await linkPointOfSale(C1, pos1.id);
  await linkPointOfSale(C2, pos2.id);
  const assign = (campaign, pos, animateur, supervisor, status) =>
    prisma.assignment.create({
      data: {
        agencyId: a,
        campaignId: campaign.id,
        pointOfSaleId: pos.id,
        animateurId: animateur.id,
        supervisorId: supervisor.id,
        proposedById: people.R1.id,
        startDate: day('2026-02-01'),
        endDate: day('2026-02-28'),
        status,
      },
    });
  await assign(C1, pos1, people.A1, people.S1, 'approved');
  await assign(C1, pos1, people.A2, people.S2, 'approved');
  await assign(C2, pos2, people.A3, people.S3, 'proposed');
  await assign(C2, pos2, people.A4, people.S3, 'approved');

  const p = people;
  await line(a, p.S1, p.R1, '2026-01-01');
  await line(a, p.S2, p.R1, '2026-01-01');
  await line(a, p.S3, p.R2, '2026-01-01');
  await line(a, p.A1, p.S1, '2026-01-01');
  await line(a, p.A2, p.S2, '2026-01-01');
  await line(a, p.A3, p.S3, '2026-01-01');
  await line(a, p.A4, p.S3, '2026-01-01');
  await line(a, p.A6, p.S3, '2026-01-01');
  // The transfer: close the line to S1, open one to S2 the same day.
  await line(a, p.A5, p.S1, '2026-01-01', TRANSFER_DAY);
  await line(a, p.A5, p.S2, TRANSFER_DAY);

  return { agency, clientX, clientY, C1, C2, ...people };
}

/** Agency 2: same shapes, with names that would match if a filter forgot agency_id. */
async function buildOtherAgency() {
  const agency = await createAgency();
  const client = await createClient(agency.id);
  const director = await createUser(agency.id, { role: 'director' });
  const animateur = await createUser(agency.id, { role: 'animateur' });
  const campaign = await createCampaign(agency.id, client.id);
  return { agency, client, director, animateur, campaign };
}

beforeAll(async () => {
  w = await buildWorld();
  other = await buildOtherAgency();
});

describe('ScopeService.resolve', () => {
  it.each([
    ['D', { level: 'agency' }],
    ['GM', { level: 'agency' }],
    ['R1', { level: 'regional', withUser: true }],
    ['S1', { level: 'supervisor', withUser: true }],
    ['A1', { level: 'self', withUser: true }],
  ])('%s → %o', (name, { level, withUser }) => {
    const scope = scopeOf(w[name]);
    expect(scope).toEqual({
      level,
      agencyId: w.agency.id,
      ...(withUser && { userId: w[name].id }),
    });
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it('client → client scope with their clientId', () => {
    expect(scopeOf(w.CU)).toEqual({
      level: 'client',
      agencyId: w.agency.id,
      clientId: w.clientX.id,
    });
  });

  it('caches the scope on the request', () => {
    const req = { actor: actorOf(w.S1) };
    expect(ScopeService.forRequest(req)).toBe(ScopeService.forRequest(req));
  });

  it('refuses non-user actors (jobs must use SYSTEM_SCOPE explicitly)', () => {
    expect(() => ScopeService.resolve({ type: 'system', id: null })).toThrow(/SYSTEM_SCOPE/);
    expect(() => ScopeService.resolve(undefined)).toThrow();
  });
});

describe('campaignWhere', () => {
  it.each([
    ['D', ['C1', 'C2']],
    ['GM', ['C1', 'C2']],
    ['R1', ['C1']],
    ['R2', ['C2']],
    ['S1', ['C1']], // staffed + supervises A1
    ['S2', ['C1']], // only supervisor_id on A2's assignment
    ['S3', ['C2']],
    ['A1', ['C1']],
    ['A2', ['C1']],
    ['A3', []], // assignment only proposed
    ['A4', ['C2']],
    ['A5', []],
    ['A6', []],
    ['CU', ['C1']], // own client only
  ])('%s sees %j', async (name, expected) => {
    expect(await campaignIds(scopeOf(w[name]))).toEqual(ids(...expected));
  });

  it('never returns another agency’s campaigns, and always filters on agencyId', async () => {
    for (const name of ['D', 'R1', 'S1', 'A1', 'CU']) {
      const scope = scopeOf(w[name]);
      expect(campaignWhere(scope).agencyId).toBe(w.agency.id);
      expect(await campaignIds(scope)).not.toContain(other.campaign.id);
    }
    expect(await campaignIds(scopeOf(other.director))).toEqual([other.campaign.id]);
  });
});

describe('userWhere', () => {
  const everyone = [
    'D',
    'GM',
    'R1',
    'R2',
    'S1',
    'S2',
    'S3',
    'A1',
    'A2',
    'A3',
    'A4',
    'A5',
    'A6',
    'CU',
  ];

  it.each([
    ['D', everyone],
    ['GM', everyone],
    ['R1', ['R1', 'S1', 'S2', 'A1', 'A2', 'A5']],
    ['R2', ['R2', 'S3', 'A3', 'A4', 'A6']],
    ['S3', ['S3', 'A3', 'A4', 'A6']],
    ['A1', ['A1']],
    ['CU', []],
  ])('%s sees %j', async (name, expected) => {
    expect(await userIds(scopeOf(w[name]), BEFORE_TRANSFER)).toEqual(ids(...expected));
  });

  it('Q-07: the transferred Animateur is visible to the old supervisor before the transfer only', async () => {
    expect(await userIds(scopeOf(w.S1), BEFORE_TRANSFER)).toEqual(ids('S1', 'A1', 'A5'));
    expect(await userIds(scopeOf(w.S1), AFTER_TRANSFER)).toEqual(ids('S1', 'A1'));
    // The transfer day belongs to the new line (valid_to is exclusive).
    expect(await userIds(scopeOf(w.S1), TRANSFER_DAY)).toEqual(ids('S1', 'A1'));
  });

  it('Q-07: … and to the new supervisor from the transfer on', async () => {
    expect(await userIds(scopeOf(w.S2), BEFORE_TRANSFER)).toEqual(ids('S2', 'A2'));
    expect(await userIds(scopeOf(w.S2), TRANSFER_DAY)).toEqual(ids('S2', 'A2', 'A5'));
    expect(await userIds(scopeOf(w.S2), AFTER_TRANSFER)).toEqual(ids('S2', 'A2', 'A5'));
  });

  it('accepts a Date for `at` and defaults to today', async () => {
    expect(await userIds(scopeOf(w.S1), new Date(`${BEFORE_TRANSFER}T12:00:00Z`))).toEqual(
      ids('S1', 'A1', 'A5'),
    );
    // Today (after the fixture's transfer) the open lines apply.
    expect(await userIds(scopeOf(w.S2))).toEqual(ids('S2', 'A2', 'A5'));
  });

  it('never returns another agency’s users, and always filters on agencyId', async () => {
    for (const name of ['D', 'R1', 'S1', 'A1', 'CU']) {
      const scope = scopeOf(w[name]);
      expect((await userWhere(scope, { at: BEFORE_TRANSFER })).agencyId).toBe(w.agency.id);
      const visible = await userIds(scope, BEFORE_TRANSFER);
      expect(visible).not.toContain(other.director.id);
      expect(visible).not.toContain(other.animateur.id);
    }
  });

  it(`a regional manager's reporting tree stops at depth ${REPORTING_TREE_MAX_DEPTH}`, async () => {
    const agency = await createAgency();
    const regional = await createUser(agency.id, { role: 'regional_manager' });
    const chain = [];
    let manager = regional;
    for (let depth = 1; depth <= REPORTING_TREE_MAX_DEPTH + 1; depth += 1) {
      const user = await createUser(agency.id, { role: depth === 1 ? 'supervisor' : 'animateur' });
      await line(agency.id, user, manager, '2026-01-01');
      chain.push(user);
      manager = user;
    }
    const scope = ScopeService.resolve(actorOf(regional));
    const visible = await userIds(scope, BEFORE_TRANSFER);
    expect(visible).toEqual(
      [regional, ...chain.slice(0, REPORTING_TREE_MAX_DEPTH)].map((u) => u.id).sort(),
    );
  });
});

describe('builders without a valid scope', () => {
  it('throw', async () => {
    expect(() => campaignWhere(undefined)).toThrow(/scope is required/);
    expect(() => campaignWhere({})).toThrow(/scope is required/);
    expect(() => campaignWhere({ level: 'agency' })).toThrow(/scope is required/);
    expect(() => campaignWhere({ level: 'regional', agencyId: w.agency.id })).toThrow();
    await expect(userWhere(undefined)).rejects.toThrow(/scope is required/);
    await expect(userWhere({ level: 'self', agencyId: w.agency.id })).rejects.toThrow();
  });

  it('a hand-made system scope is rejected; only SYSTEM_SCOPE is unrestricted', async () => {
    expect(() => campaignWhere({ level: 'system' })).toThrow(/scope is required/);
    expect(campaignWhere(SYSTEM_SCOPE)).toEqual({});
    expect(await userWhere(SYSTEM_SCOPE)).toEqual({});
  });

  it('reject a malformed `at`', async () => {
    await expect(userWhere(scopeOf(w.S1), { at: '01/03/2026' })).rejects.toThrow(/`at`/);
  });
});

describe('scoped()', () => {
  it('ANDs the scope filter with the caller filter', async () => {
    const scope = scopeOf(w.R1);
    expect(scoped(campaignWhere(scope), { id: w.C2.id })).toEqual({
      AND: [campaignWhere(scope), { id: w.C2.id }],
    });
    // Out of scope by id → nothing (the service turns this into NotFoundError).
    expect(
      await prisma.campaign.findFirst({ where: scoped(campaignWhere(scope), { id: w.C2.id }) }),
    ).toBeNull();
    expect(
      await prisma.campaign.findFirst({ where: scoped(campaignWhere(scope), { id: w.C1.id }) }),
    ).not.toBeNull();
  });

  it('returns the scope filter alone when there is no extra filter, and needs one', () => {
    const filter = campaignWhere(scopeOf(w.D));
    expect(scoped(filter)).toBe(filter);
    expect(() => scoped(undefined, { id: 'x' })).toThrow();
  });
});
