import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../db/client.js';
import { withTransaction } from '../../../db/transaction.js';
import { createAgency, createUser } from '../../../db/__tests__/factories.js';
import { SYSTEM_ACTOR } from '../../auth/index.js';
import { auditService, redactSecrets } from '../index.js';

let agency;
let user;
beforeAll(async () => {
  agency = await createAgency();
  user = await createUser(agency.id, { role: 'director' });
});

const actorOf = (u) => ({ type: 'user', id: u.id, agencyId: u.agencyId });

describe('auditService.record', () => {
  it('writes the row with the transaction client, request id and ip', async () => {
    const { id } = await withTransaction((tx) =>
      auditService.record(tx, {
        actor: actorOf(user),
        action: 'test.recorded',
        entityType: 'user',
        entityId: user.id,
        before: { fullName: 'Old' },
        after: { fullName: 'New', at: new Date('2026-01-02T03:04:05Z') },
        req: { ip: '::ffff:10.0.0.7', id: 'b3a1c1de-0000-4000-8000-000000000000' },
      }),
    );

    const row = await prisma.auditLog.findUnique({ where: { id } });
    expect(row).toMatchObject({
      agencyId: agency.id,
      actorType: 'user',
      actorId: user.id,
      action: 'test.recorded',
      entityType: 'user',
      entityId: user.id,
      before: { fullName: 'Old' },
      after: { fullName: 'New', at: '2026-01-02T03:04:05.000Z' },
      requestId: 'b3a1c1de-0000-4000-8000-000000000000',
    });
    expect(row.ip).toMatch(/10\.0\.0\.7/);
  });

  it('is rolled back together with the change when the transaction fails', async () => {
    await expect(
      withTransaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { fullName: 'Renamed in tx' } });
        await auditService.record(tx, {
          actor: actorOf(user),
          action: 'test.rolled_back',
          entityType: 'user',
          entityId: user.id,
        });
        throw new Error('boom after audit');
      }),
    ).rejects.toThrow('boom after audit');

    expect(await prisma.auditLog.count({ where: { action: 'test.rolled_back' } })).toBe(0);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.fullName).not.toBe('Renamed in tx');
  });

  it('never stores passwords, hashes or tokens in before/after, at any depth', async () => {
    const secretish = {
      passwordHash: '$argon2id$v=19$secret',
      password: 'plain-text-1',
      newPassword: 'plain-text-2',
      refreshToken: 'raw-refresh',
      accessToken: 'raw-access',
      token: 'raw',
      tokenHash: 'abc123',
      nested: { token_hash: 'def456', clientSecret: 's', list: [{ currentPassword: 'p' }] },
      mustChangePassword: true,
      tokenVersion: 3,
      email: 'kept@test.local',
    };
    const { id } = await withTransaction((tx) =>
      auditService.record(tx, {
        actor: SYSTEM_ACTOR,
        agencyId: agency.id,
        action: 'test.redacted',
        entityType: 'user',
        entityId: user.id,
        before: secretish,
        after: secretish,
      }),
    );

    const row = await prisma.auditLog.findUnique({ where: { id } });
    const expected = {
      nested: { list: [{}] },
      mustChangePassword: true,
      tokenVersion: 3,
      email: 'kept@test.local',
    };
    expect(row.before).toEqual(expected);
    expect(row.after).toEqual(expected);
    expect(row).toMatchObject({ actorType: 'system', actorId: null });
    expect(JSON.stringify([row.before, row.after])).not.toMatch(
      /argon2|plain-text|raw-|abc123|def456/,
    );
  });

  it('requires a known actor type and an agency', async () => {
    await expect(
      withTransaction((tx) =>
        auditService.record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'x',
          entityType: 'user',
          entityId: user.id,
        }),
      ),
    ).rejects.toThrow(/agencyId is required/);
    await expect(
      withTransaction((tx) =>
        auditService.record(tx, {
          actor: { type: 'robot', id: null, agencyId: agency.id },
          action: 'x',
          entityType: 'user',
          entityId: user.id,
        }),
      ),
    ).rejects.toThrow(/unknown actor type/);
  });

  it('redactSecrets keeps non-secret values and converts dates and bigints', () => {
    expect(redactSecrets({ a: 1n, b: [new Date(0)], c: null, d: 'x' })).toEqual({
      a: '1',
      b: ['1970-01-01T00:00:00.000Z'],
      c: null,
      d: 'x',
    });
  });
});
