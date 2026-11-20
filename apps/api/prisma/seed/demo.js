import { hashPassword } from '../../src/core/auth/passwords.js';
import { businessDate } from '../../src/core/time/clock.js';
import { withTransaction } from '../../src/db/transaction.js';

const WILAYAS = [16, 9, 35, 31, 27, 22];

export function demoPassword(environment) {
  if (environment.NODE_ENV === 'production')
    throw new Error('Demo seeding is disabled in production');
  if (!environment.DEMO_PASSWORD?.trim())
    throw new Error('Set DEMO_PASSWORD to seed demo accounts');
  return environment.DEMO_PASSWORD;
}

export async function seedDemo({ agency, environment = process.env, client }) {
  const passwordHash = await hashPassword(demoPassword(environment));
  const agencyId = agency.id;
  const validFrom = new Date(businessDate());
  return withTransaction(
    async (tx) => {
      const director = await tx.user.findFirst({
        where: { agencyId, role: 'director', status: 'active', isDemo: false },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!director) throw new Error('Bootstrap an active director before seeding demo staff');

      async function staff(role, number, managerId, wilayaId) {
        const email = 'demo.' + role + '.' + number + '@' + agency.code.toLowerCase() + '.example';
        const existing = await tx.user.findUnique({
          where: { email },
          select: { id: true, isDemo: true, agencyId: true, role: true },
        });
        if (existing) {
          if (!existing.isDemo || existing.agencyId !== agencyId || existing.role !== role) {
            throw new Error('A demo staff email is already in use');
          }
          return existing.id;
        }
        const { id } = await tx.user.create({
          data: {
            agencyId,
            role,
            wilayaId,
            email,
            fullName: 'Demo ' + role.replace('_', ' ') + ' ' + number,
            passwordHash,
            mustChangePassword: false,
            isDemo: true,
            animateurProfile:
              role === 'animateur'
                ? { create: { agencyId, skills: [], languages: ['ar', 'fr'] } }
                : undefined,
          },
          select: { id: true },
        });
        await tx.reportingLine.create({ data: { agencyId, userId: id, managerId, validFrom } });
        return id;
      }

      const general = await staff('general_manager', 1, director.id);
      for (let regionNumber = 0; regionNumber < 2; regionNumber++) {
        const wilayas = WILAYAS.slice(regionNumber * 3, regionNumber * 3 + 3);
        const code = 'DEMO-REG-' + (regionNumber + 1);
        const region = await tx.region.upsert({
          where: { agencyId_code: { agencyId, code } },
          create: { agencyId, code, name: 'Demo region ' + (regionNumber + 1), isDemo: true },
          update: {},
        });
        if (!region.isDemo) throw new Error('A demo region code is already in use');
        for (const wilayaId of wilayas) {
          const assignment = await tx.regionWilaya.upsert({
            where: { agencyId_wilayaId: { agencyId, wilayaId } },
            create: { agencyId, wilayaId, regionId: region.id },
            update: {},
          });
          if (assignment.regionId !== region.id)
            throw new Error('A demo wilaya belongs to another region');
        }
        const manager = await staff('regional_manager', regionNumber + 1, general, wilayas[0]);
        for (let index = 0; index < 2; index++) {
          const number = regionNumber * 2 + index + 1;
          const supervisor = await staff('supervisor', number, manager, wilayas[index]);
          for (let employee = 0; employee < 3; employee++) {
            await staff(
              'animateur',
              (number - 1) * 3 + employee + 1,
              supervisor,
              wilayas[employee],
            );
          }
        }
      }
      for (let index = 0; index < 20; index++) {
        const code = 'DEMO-POS-' + (index + 1);
        const wilayaId = WILAYAS[index % WILAYAS.length];
        const pos = await tx.pointOfSale.upsert({
          where: { agencyId_code: { agencyId, code } },
          create: {
            agencyId,
            code,
            wilayaId,
            type: 'retail',
            name: 'Demo Point de Vente ' + (index + 1),
            isDemo: true,
          },
          update: {},
        });
        if (!pos.isDemo) throw new Error('A demo point-of-sale code is already in use');
      }
    },
    { client, timeoutMs: 60000 },
  );
}
