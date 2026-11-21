// Supervisor quota and team: the director sets how many Animateurs each supervisor brings; the
// supervisor picks his existing Animateurs or creates new ones; nobody sees another team.
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { createPointOfSale, createUser, day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { createWorld, offsetDate } from './fixtures.js';

let w;
beforeAll(async () => {
  w = await createWorld(createApp());
});

/** An Animateur of the supervisor's own (reports to him), not yet in any campaign. */
async function ownAnimateur(supervisor = 'supervisor') {
  const user = await createUser(w.agency.id, { role: 'animateur' });
  await prisma.reportingLine.create({
    data: {
      agencyId: w.agency.id,
      userId: user.id,
      managerId: w.people[supervisor].id,
      validFrom: day(offsetDate(-10)),
    },
  });
  return user;
}

/** A draft campaign in wilaya 16 with `supervisor` (quota 2) and `supervisorTwo` (quota 1). */
async function campaignWithSupervisors() {
  const { campaign } = await w.draftCampaign({}, 0);
  const path = '/campaigns/' + campaign.id;
  await w.ok(w.send('put', path + '/wilayas', 'director', { wilayas: [{ wilayaId: 16 }] }));
  const staff = {};
  for (const [name, requiredAnimateurs] of [
    ['supervisor', 2],
    ['supervisorTwo', 1],
  ]) {
    staff[name] = await w.ok(
      w.send('post', path + '/staff', 'director', {
        userId: w.people[name].id,
        wilayaId: 16,
        role: 'supervisor',
        requiredAnimateurs,
      }),
      201,
    );
  }
  return { campaign, path, staff };
}

const newAnimateur = (patch = {}) => ({
  fullName: 'Nadia New',
  email: `new-${Math.random().toString(36).slice(2, 10)}@example.test`,
  wilayaId: 16,
  ...patch,
});

describe('supervisor quota and team', () => {
  it('derives the wilaya need from the supervisors quotas', async () => {
    const { path } = await campaignWithSupervisors();
    const detail = await w.ok(w.send('get', path));
    expect(detail.wilayas[0].requiredAnimateurs).toBe(3);
    expect(detail.counts.requiredAnimateurs).toBe(3);
    expect(detail.wilayas[0].staff.map((member) => member.requiredAnimateurs).sort()).toEqual([
      1, 2,
    ]);
    // Typing a need for the wilaya has no effect any more.
    const again = await w.ok(
      w.send('put', path + '/wilayas', 'director', {
        wilayas: [{ wilayaId: 16, requiredAnimateurs: 50 }],
      }),
    );
    expect(again.wilayas[0].requiredAnimateurs).toBe(3);
  });

  it('lets the supervisor pick his own Animateur, then refuses a duplicate', async () => {
    const { path } = await campaignWithSupervisors();
    const mine = await ownAnimateur();
    const member = await w.ok(
      w.send('post', path + '/team', 'supervisor', { animateurId: mine.id }),
      201,
    );
    expect(member.animateur.id).toBe(mine.id);
    await w.rejected(
      w.send('post', path + '/team', 'supervisor', { animateurId: mine.id }),
      422,
      'ANIMATEUR_ALREADY_IN_TEAM',
    );
    // Someone else's Animateur is not visible to him.
    const theirs = await ownAnimateur('supervisorTwo');
    await w.rejected(
      w.send('post', path + '/team', 'supervisor', { animateurId: theirs.id }),
      404,
      'NOT_FOUND',
    );
    // A supervisor is not an Animateur.
    await w.rejected(
      w.send('post', path + '/team', 'supervisor', { animateurId: w.people.supervisor.id }),
      422,
      'NOT_AN_ANIMATEUR',
    );
  });

  it('creates a new Animateur under the supervisor and stops at the quota', async () => {
    const { campaign, path } = await campaignWithSupervisors();
    await w.ok(
      w.send('post', path + '/team', 'supervisor', { animateurId: (await ownAnimateur()).id }),
      201,
    );
    const created = await w.ok(
      w.send('post', path + '/team/new', 'supervisor', newAnimateur({ phone: '0555123456' })),
      201,
    );
    expect(created.temporaryPassword).toEqual(expect.any(String));
    expect(created.user).toMatchObject({ role: 'animateur', wilayaId: 16 });
    const line = await prisma.reportingLine.findFirst({
      where: { userId: created.user.id, validTo: null },
    });
    expect(line.managerId).toBe(w.people.supervisor.id);
    expect(
      await prisma.campaignAnimateur.count({
        where: { campaignId: campaign.id, supervisorId: w.people.supervisor.id },
      }),
    ).toBe(2);
    // Quota 2 reached: neither way of adding works any more, and no account is left behind.
    const before = await prisma.user.count({ where: { agencyId: w.agency.id } });
    await w.rejected(
      w.send('post', path + '/team/new', 'supervisor', newAnimateur()),
      422,
      'SUPERVISOR_QUOTA_REACHED',
    );
    await w.rejected(
      w.send('post', path + '/team', 'supervisor', { animateurId: (await ownAnimateur()).id }),
      422,
      'SUPERVISOR_QUOTA_REACHED',
    );
    expect(await prisma.user.count({ where: { agencyId: w.agency.id } })).toBe(before + 1);
  });

  it('only creates Animateurs in a wilaya the supervisor covers', async () => {
    const { path } = await campaignWithSupervisors();
    await w.rejected(
      w.send('post', path + '/team/new', 'supervisor', newAnimateur({ wilayaId: 31 })),
      422,
      'WILAYA_NOT_IN_CAMPAIGN',
    );
  });

  it('keeps every team private to its supervisor', async () => {
    const { path } = await campaignWithSupervisors();
    const mine = await ownAnimateur();
    await w.ok(w.send('post', path + '/team', 'supervisor', { animateurId: mine.id }), 201);
    const other = await ownAnimateur('supervisorTwo');
    await w.ok(w.send('post', path + '/team', 'supervisorTwo', { animateurId: other.id }), 201);

    const seenByOne = await w.ok(w.send('get', path + '/team', 'supervisor'));
    expect(seenByOne.map((row) => row.animateur.id)).toEqual([mine.id]);
    const seenByTwo = await w.ok(w.send('get', path + '/team', 'supervisorTwo'));
    expect(seenByTwo.map((row) => row.animateur.id)).toEqual([other.id]);
    expect(await w.ok(w.send('get', path + '/team', 'director'))).toHaveLength(2);

    await w.rejected(
      w.send('delete', path + '/team/' + mine.id, 'supervisorTwo'),
      404,
      'NOT_FOUND',
    );
    await w.rejected(w.send('get', path + '/team', 'animateur'), 404, 'NOT_FOUND');
    await w.rejected(
      w.send('post', path + '/team', 'animateur', { animateurId: mine.id }),
      403,
      'FORBIDDEN',
    );
  });

  it('lets the director act for a supervisor and keeps the quota above the team size', async () => {
    const { path, staff } = await campaignWithSupervisors();
    const mine = await ownAnimateur();
    await w.rejected(
      w.send('post', path + '/team', 'director', { animateurId: mine.id }),
      400,
      'VALIDATION_FAILED',
    );
    await w.ok(
      w.send('post', path + '/team', 'director', {
        animateurId: mine.id,
        supervisorId: w.people.supervisor.id,
      }),
      201,
    );
    await w.ok(
      w.send('post', path + '/team', 'supervisor', { animateurId: (await ownAnimateur()).id }),
      201,
    );
    await w.rejected(
      w.send('patch', path + '/staff/' + staff.supervisor.id, 'director', {
        requiredAnimateurs: 1,
      }),
      422,
      'QUOTA_BELOW_TEAM_SIZE',
    );
    await w.ok(
      w.send('patch', path + '/staff/' + staff.supervisor.id, 'director', {
        requiredAnimateurs: 4,
      }),
    );
    expect((await w.ok(w.send('get', path))).wilayas[0].requiredAnimateurs).toBe(5);
    await w.rejected(
      w.send('patch', path + '/staff/' + staff.supervisor.id, 'supervisor', {
        requiredAnimateurs: 99,
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('keeps a supervisor who still has a team, and frees the quota when a member leaves', async () => {
    const { path, staff } = await campaignWithSupervisors();
    const mine = await ownAnimateur();
    await w.ok(w.send('post', path + '/team', 'supervisor', { animateurId: mine.id }), 201);
    await w.rejected(
      w.send('delete', path + '/staff/' + staff.supervisor.id),
      422,
      'STAFF_HAS_TEAM',
    );
    expect((await w.ok(w.send('get', path))).wilayas[0].staff).toEqual(
      expect.arrayContaining([expect.objectContaining({ teamCount: 1 })]),
    );
    await w.ok(w.send('delete', path + '/team/' + mine.id, 'supervisor'), 204);
    expect(await w.ok(w.send('get', path + '/team', 'supervisor'))).toEqual([]);
    await w.ok(w.send('delete', path + '/staff/' + staff.supervisor.id), 204);
    expect((await w.ok(w.send('get', path))).wilayas[0].requiredAnimateurs).toBe(1);
  });

  it('blocks "mark as assigned" while a supervisor is below his quota', async () => {
    const { campaign } = await w.readyCampaign({ status: 'planning' });
    const blockers = async () =>
      (await w.ok(w.send('get', `/campaigns/${campaign.id}/readiness`, 'director'))).actions.find(
        (item) => item.action === 'mark-assigned',
      ).blockers;
    expect(await blockers()).toEqual([]);
    await prisma.campaignStaff.updateMany({
      where: { campaignId: campaign.id, role: 'supervisor' },
      data: { requiredAnimateurs: 2 },
    });
    expect(await blockers()).toEqual([
      {
        code: 'SUPERVISOR_BELOW_QUOTA',
        details: {
          supervisors: [{ supervisorId: w.people.supervisor.id, required: 2, count: 0 }],
        },
      },
    ]);
  });
});

describe('proposals use the supervisor team', () => {
  it('only proposes Animateurs of the supervisor team and lists only them as candidates', async () => {
    const { campaign, path } = await campaignWithSupervisors();
    const point = await createPointOfSale(w.agency.id, { wilayaId: 16 });
    await prisma.campaignPointOfSale.create({
      data: { campaignId: campaign.id, agencyId: w.agency.id, pointOfSaleId: point.id },
    });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'assigned' } });
    const inTeam = await ownAnimateur();
    const outside = await ownAnimateur();
    await w.ok(w.send('post', path + '/team', 'supervisor', { animateurId: inTeam.id }), 201);
    const body = (user) => ({
      animateurId: user.id,
      pointOfSaleId: point.id,
      startDate: offsetDate(11),
      endDate: offsetDate(20),
    });
    await w.rejected(
      w.send('post', path + '/assignments', 'supervisor', body(outside)),
      422,
      'ANIMATEUR_NOT_IN_TEAM',
    );
    await w.ok(w.send('post', path + '/assignments', 'supervisor', body(inTeam)), 201);
    const candidates = await w.ok(
      w.send(
        'get',
        `${path}/assignment-candidates?wilayaId=16&from=${offsetDate(30)}&to=${offsetDate(31)}`,
        'supervisor',
      ),
    );
    expect(candidates.map(({ id }) => id)).toEqual([inTeam.id]);
  });
});
