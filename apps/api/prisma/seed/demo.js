import { hashPassword } from '../../src/core/auth/passwords.js';
import { businessDate } from '../../src/core/time/clock.js';
import { withTransaction } from '../../src/db/transaction.js';
import { insertDraftCampaign } from '../../src/modules/campaigns/campaigns.repository.js';

const WILAYAS = [16, 9, 35, 31, 27, 22];

export function demoPassword(environment) {
  if (environment.NODE_ENV === 'production')
    throw new Error('Demo seeding is disabled in production');
  if (!environment.DEMO_PASSWORD?.trim())
    throw new Error('Set DEMO_PASSWORD to seed demo accounts');
  return environment.DEMO_PASSWORD;
}

const DEMO_PRODUCTS = [
  ['Detergent 1 kg', 'bag', '450.00'],
  ['Detergent 3 kg', 'bag', '1250.00'],
  ['Softener 1 L', 'bottle', '320.50'],
  ['Dish soap 750 ml', 'bottle', null],
];
const DEMO_STOCK_ITEMS = [
  ['gift', 'Branded mug', 'piece'],
  ['gift', 'Tote bag', 'piece'],
  ['gift', 'Key ring', 'piece'],
  ['sample', 'Trial sachet', 'sachet'],
];

/**
 * One demo client with 4 products, 3 gifts, 1 sample and 1 portal account. Clients, products and
 * stock items have no `is_demo` column: they are found again by name / `DEMO-` SKU.
 */
async function catalog(tx, { agencyId, code, number, passwordHash }) {
  const name = 'Demo client ' + number;
  const client =
    (await tx.client.findFirst({ where: { agencyId, name, deletedAt: null } })) ??
    (await tx.client.create({ data: { agencyId, name, contactName: 'Demo contact ' + number } }));
  for (const [index, [productName, unitLabel, referencePrice]] of DEMO_PRODUCTS.entries()) {
    const sku = 'DEMO-P' + number + '-' + (index + 1);
    await tx.product.upsert({
      where: { clientId_sku: { clientId: client.id, sku } },
      create: { agencyId, clientId: client.id, sku, name: productName, unitLabel, referencePrice },
      update: {},
    });
  }
  for (const [index, [kind, itemName, unitLabel]] of DEMO_STOCK_ITEMS.entries()) {
    const sku = 'DEMO-' + (kind === 'gift' ? 'G' : 'S') + number + '-' + (index + 1);
    await tx.stockItem.upsert({
      where: { clientId_sku: { clientId: client.id, sku } },
      create: { agencyId, clientId: client.id, kind, sku, name: itemName, unitLabel },
      update: {},
    });
  }
  const email = 'demo.client.' + number + '@' + code.toLowerCase() + '.example';
  const existing = await tx.user.findUnique({
    where: { email },
    select: { isDemo: true, agencyId: true, role: true },
  });
  if (existing) {
    if (!existing.isDemo || existing.agencyId !== agencyId || existing.role !== 'client') {
      throw new Error('A demo portal email is already in use');
    }
    return;
  }
  await tx.user.create({
    data: {
      agencyId,
      role: 'client',
      clientId: client.id,
      email,
      fullName: 'Demo portal user ' + number,
      passwordHash,
      mustChangePassword: false,
      isDemo: true,
    },
  });
}

const plusDays = (iso, days) => {
  const date = new Date(iso + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Draft campaign N for demo client N: the first two wilayas of demo region N (3 Animateurs each),
 * its regional manager on both, one supervisor per wilaya, the demo points of sale there and all the
 * client's demo products. No documents. Found again by its name.
 */
async function demoCampaign(tx, { agency, number, directorId }) {
  const agencyId = agency.id;
  const name = 'Demo campaign ' + number;
  if (await tx.campaign.findFirst({ where: { agencyId, name }, select: { id: true } })) return;
  const client = await tx.client.findFirst({
    where: { agencyId, name: 'Demo client ' + number, deletedAt: null },
    select: { id: true },
  });
  const wilayas = WILAYAS.slice((number - 1) * 3, (number - 1) * 3 + 2);
  const email = (role, index) =>
    'demo.' + role + '.' + index + '@' + agency.code.toLowerCase() + '.example';
  const people = await tx.user.findMany({
    where: {
      agencyId,
      email: {
        in: [
          email('regional_manager', number),
          email('supervisor', number * 2 - 1),
          email('supervisor', number * 2),
        ],
      },
    },
    select: { id: true, email: true },
  });
  const idOf = (address) => people.find((person) => person.email === address).id;
  const startDate = plusDays(businessDate(), 14);
  const scope = { level: 'agency', agencyId };
  const campaign = await insertDraftCampaign(
    tx,
    scope,
    {
      clientId: client.id,
      name,
      description: 'Demo draft campaign',
      startDate,
      endDate: plusDays(startDate, 30),
      budgetAmount: '1500000.00',
    },
    directorId,
  );
  const campaignId = campaign.id;
  await tx.campaignWilaya.createMany({
    data: wilayas.map((wilayaId) => ({ agencyId, campaignId, wilayaId, requiredAnimateurs: 3 })),
  });
  await tx.campaignStaff.createMany({
    data: wilayas.flatMap((wilayaId, index) => [
      {
        agencyId,
        campaignId,
        wilayaId,
        role: 'regional_manager',
        userId: idOf(email('regional_manager', number)),
      },
      {
        agencyId,
        campaignId,
        wilayaId,
        role: 'supervisor',
        userId: idOf(email('supervisor', number * 2 - 2 + index + 1)),
      },
    ]),
  });
  const points = await tx.pointOfSale.findMany({
    where: { agencyId, isDemo: true, deletedAt: null, wilayaId: { in: wilayas } },
    select: { id: true },
  });
  await tx.campaignPointOfSale.createMany({
    data: points.map(({ id }) => ({ agencyId, campaignId, pointOfSaleId: id })),
  });
  const products = await tx.product.findMany({
    where: { agencyId, clientId: client.id, deletedAt: null, sku: { startsWith: 'DEMO-' } },
    select: { id: true },
  });
  await tx.campaignProduct.createMany({
    data: products.map(({ id }) => ({ agencyId, campaignId, productId: id })),
  });
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
      for (let number = 1; number <= 2; number++) {
        await catalog(tx, { agencyId, code: agency.code, number, passwordHash });
      }
      for (let number = 1; number <= 2; number++) {
        await demoCampaign(tx, { agency, number, directorId: director.id });
      }
    },
    { client, timeoutMs: 60000 },
  );
}
