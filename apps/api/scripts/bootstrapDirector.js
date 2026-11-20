// Creates the first director of the seeded agency with a temporary password (FR-002).
// Usage: npm run db:bootstrap -- --email boss@agency.dz --name "Full Name"
// Refuses to run when the agency already has a director. The password is printed once, never stored.
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { emailSchema, passwordPolicyViolations } from '@fieldflow/shared';
import { z } from 'zod';
import { SYSTEM_ACTOR, hashPassword } from '../src/core/auth/index.js';
import { auditService } from '../src/core/audit/index.js';
import { disconnectDatabase, prisma } from '../src/db/client.js';
import { withTransaction } from '../src/db/transaction.js';
import { AUTH_ACTIONS } from '../src/modules/auth/auth.events.js';

const TEMPORARY_PASSWORD_LENGTH = 16;
// No look-alike characters (0/O, 1/l/I) since the password is read off a terminal.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export class BootstrapError extends Error {}

const inputSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1).max(120),
  agencyCode: z
    .string()
    .regex(/^[A-Z0-9-]{2,20}$/, 'SEED_AGENCY_CODE must match ^[A-Z0-9-]{2,20}$'),
});

/** 16 random characters that satisfy the password policy. */
export function generateTemporaryPassword() {
  for (;;) {
    const password = Array.from(
      { length: TEMPORARY_PASSWORD_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    if (passwordPolicyViolations(password).length === 0) return password;
  }
}

/**
 * @param {{ email: string, fullName: string, agencyCode: string }} input
 * @param {import('@prisma/client').PrismaClient} [client]
 * @returns {Promise<{ user: { id: string, email: string, fullName: string }, temporaryPassword: string }>}
 */
export async function bootstrapDirector(input, client = prisma) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BootstrapError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  }
  const { email, fullName, agencyCode } = parsed.data;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await withTransaction(
    async (tx) => {
      const agency = await tx.agency.findUnique({ where: { code: agencyCode } });
      if (!agency) {
        throw new BootstrapError(`Agency ${agencyCode} not found: run \`npm run db:seed\` first.`);
      }
      const directors = await tx.user.count({ where: { agencyId: agency.id, role: 'director' } });
      if (directors > 0) {
        throw new BootstrapError(
          `Agency ${agencyCode} already has a director; bootstrap runs only once.`,
        );
      }
      const created = await tx.user.create({
        data: {
          agencyId: agency.id,
          role: 'director',
          fullName,
          email,
          passwordHash,
          mustChangePassword: true,
        },
        select: { id: true, email: true, fullName: true },
      });
      await auditService.record(tx, {
        actor: SYSTEM_ACTOR,
        agencyId: agency.id,
        action: AUTH_ACTIONS.DIRECTOR_BOOTSTRAPPED,
        entityType: 'user',
        entityId: created.id,
        after: { role: 'director', fullName, mustChangePassword: true },
      });
      return created;
    },
    // Serializable: two concurrent runs cannot both see "no director" and both insert one.
    { client, isolationLevel: 'Serializable' },
  );

  return { user, temporaryPassword };
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  });
  if (!values.email || !values.name) {
    throw new BootstrapError('Usage: npm run db:bootstrap -- --email <email> --name "<full name>"');
  }
  const { user, temporaryPassword } = await bootstrapDirector({
    email: values.email,
    fullName: values.name,
    agencyCode: process.env.SEED_AGENCY_CODE ?? '',
  });
  process.stdout.write(
    `Director created: ${user.fullName} <${user.email}>\n` +
      `Temporary password (shown once, not stored): ${temporaryPassword}\n` +
      'It must be changed at the first sign-in.\n',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
