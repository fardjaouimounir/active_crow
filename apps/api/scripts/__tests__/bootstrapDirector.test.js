import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { passwordPolicyViolations } from '@fieldflow/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/core/auth/index.js';
import { databaseUrl, prisma } from '../../src/db/client.js';
import { createAgency } from '../../src/db/__tests__/factories.js';
import {
  BootstrapError,
  bootstrapDirector,
  generateTemporaryPassword,
} from '../bootstrapDirector.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../bootstrapDirector.js', import.meta.url));

describe('db:bootstrap', () => {
  let agency;
  beforeAll(async () => {
    agency = await createAgency({ code: 'BOOT-TEST' });
  });

  it('creates exactly one director with a temporary password and must_change_password', async () => {
    const { user, temporaryPassword } = await bootstrapDirector({
      email: '  First.Director@Agency.DZ ',
      fullName: 'First Director',
      agencyCode: agency.code,
    });

    expect(temporaryPassword).toHaveLength(16);
    expect(passwordPolicyViolations(temporaryPassword)).toEqual([]);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored).toMatchObject({
      agencyId: agency.id,
      role: 'director',
      email: 'first.director@agency.dz',
      fullName: 'First Director',
      status: 'active',
      mustChangePassword: true,
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(temporaryPassword);
    expect(await verifyPassword(stored.passwordHash, temporaryPassword)).toBe(true);

    const [audit] = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.director_bootstrapped' },
    });
    expect(audit).toMatchObject({ actorType: 'system', actorId: null, agencyId: agency.id });
    expect(JSON.stringify(audit.after)).not.toContain(temporaryPassword);
  });

  it('refuses a second run and creates nothing', async () => {
    await expect(
      bootstrapDirector({ email: 'second@agency.dz', fullName: 'Second', agencyCode: agency.code }),
    ).rejects.toThrow(BootstrapError);
    expect(await prisma.user.count({ where: { agencyId: agency.id, role: 'director' } })).toBe(1);
    expect(await prisma.user.count({ where: { email: 'second@agency.dz' } })).toBe(0);
  });

  it('refuses an unknown agency and invalid input', async () => {
    await expect(
      bootstrapDirector({ email: 'x@agency.dz', fullName: 'X', agencyCode: 'NOPE' }),
    ).rejects.toThrow(/db:seed/);
    await expect(
      bootstrapDirector({ email: 'not-an-email', fullName: '', agencyCode: agency.code }),
    ).rejects.toThrow(BootstrapError);
  });

  it('generates policy-compliant temporary passwords without look-alike characters', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{16}$/);
      expect(passwordPolicyViolations(password)).toEqual([]);
    }
  });

  it('as a CLI: prints the temporary password once, then refuses to run again', async () => {
    const cliAgency = await createAgency({ code: 'BOOT-CLI' });
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      SEED_AGENCY_CODE: cliAgency.code,
    };
    const args = [script, '--email', 'cli@agency.dz', '--name', 'Cli Director'];

    const first = await run(process.execPath, args, { env });
    const password = first.stdout.match(
      /Temporary password \(shown once, not stored\): (\S{16})/,
    )?.[1];
    expect(password).toBeDefined();
    expect(first.stdout).toContain('Cli Director <cli@agency.dz>');

    const second = await run(process.execPath, args, { env }).catch((err) => err);
    expect(second.code).toBe(1);
    expect(second.stderr).toMatch(/already has a director/);
    expect(await prisma.user.count({ where: { agencyId: cliAgency.id, role: 'director' } })).toBe(
      1,
    );
  });
});
