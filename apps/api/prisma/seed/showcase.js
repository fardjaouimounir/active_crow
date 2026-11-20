// Demo showcase: turns the demo agency into a campaign that has been running for ten days, so every
// screen of every role has something to show. It uses the real API in-process (as each user, with a
// controlled clock) so attendance, sales, gift entitlements, stock, visits, the Tombola and the
// notifications are all consistent. Run it once with `npm run db:seed:showcase`.
//
// Needs the demo organization (users `*@demo.test`) and DEMO_PASSWORD in apps/api/.env.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';

// Quiet logs (one line per request is too much here); the app modules read this when imported.
process.env.LOG_LEVEL ??= 'silent';
const { createApp } = await import('../../src/app.js');
const { hashPassword } = await import('../../src/core/auth/passwords.js');
const { businessDate, clock } = await import('../../src/core/time/clock.js');
const { disconnectDatabase, prisma } = await import('../../src/db/client.js');
const realNow = clock.now;

const AGENCY_CODE = process.env.SHOWCASE_AGENCY ?? 'DEMO-MOUNIR';
const CAMPAIGN = 'Demo campaign 1';
const DAYS_BACK = 10;
const password = process.env.DEMO_PASSWORD?.trim();
if (!password) throw new Error('Set DEMO_PASSWORD in apps/api/.env');

const app = createApp();
const log = (message) => process.stdout.write(message + '\n');
const addDays = (iso, days) => {
  const date = new Date(iso + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
/** Africa/Algiers is UTC+1 all year. */
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`);
const setClock = (date, hhmm) => {
  const instant = at(date, hhmm);
  clock.now = () => new Date(instant);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── HTTP as a given user ────────────────────────────────────────────────────

const tokens = new Map();
const recent = [];
async function pace() {
  // The API allows 300 requests a minute per address.
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 240) await sleep(60_000 - (now - recent[0]) + 100);
  recent.push(Date.now());
}
async function login(email) {
  await pace();
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  tokens.set(email, res.body.data.accessToken);
  return res.body.data.accessToken;
}
async function call(email, method, path, { body, fields, files, json = true } = {}) {
  await pace();
  const token = tokens.get(email) ?? (await login(email));
  const req = request(app)
    [method]('/api/v1' + path)
    .set('Authorization', `Bearer ${token}`);
  if (method === 'post') req.set('Idempotency-Key', randomUUID());
  let res;
  if (fields || files) {
    for (const [name, value] of Object.entries(fields ?? {})) req.field(name, value);
    for (const [name, buffer] of files ?? []) req.attach(name, buffer, 'photo.jpg');
    res = await req;
  } else {
    res = await (body === undefined ? req : req.send(body));
  }
  if (res.status >= 300) {
    const error = new Error(
      `${email} ${method.toUpperCase()} ${path} → ${res.status} ${res.body?.error?.code ?? ''}`,
    );
    error.status = res.status;
    error.code = res.body?.error?.code;
    error.details = res.body?.error?.details;
    throw error;
  }
  return json ? res.body.data : res.body;
}
const tryCall = async (...args) => {
  try {
    return await call(...args);
  } catch (error) {
    log(`  ! ${error.message}`);
    return null;
  }
};

// ─── Photos ──────────────────────────────────────────────────────────────────

const COLORS = ['#2f6f8f', '#8f5a2f', '#3d8f4f', '#7a3d8f', '#8f3d4a', '#4a5a8f'];
async function photo(text, index = 0) {
  const svg = Buffer.from(
    `<svg width="640" height="420" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="420" fill="${COLORS[index % COLORS.length]}"/><text x="320" y="200" font-size="34" fill="white" text-anchor="middle" font-family="sans-serif">${text}</text><text x="320" y="250" font-size="22" fill="#ffffffcc" text-anchor="middle" font-family="sans-serif">FieldFlow demo</text></svg>`,
  );
  return sharp(svg).jpeg({ quality: 80 }).toBuffer();
}

// ─── Main ────────────────────────────────────────────────────────────────────

const agency = await prisma.agency.findUniqueOrThrow({ where: { code: AGENCY_CODE } });
const users = await prisma.user.findMany({ where: { agencyId: agency.id, isDemo: true } });
const user = (email) =>
  users.find((candidate) => candidate.email === email) ??
  (() => {
    throw new Error('Missing demo user ' + email);
  })();
const DIRECTOR = 'admin@demo.test';
const REGIONAL = 'regional1@demo.test';
const SUPERVISORS = ['supervisor1@demo.test', 'supervisor2@demo.test'];
const ANIMATEURS = [1, 2, 3, 4, 5, 6].map((n) => `animateur${n}@demo.test`);
const CLIENT = 'client1@demo.test';

// 1. One shared password for every demo account.
const passwordHash = await hashPassword(password);
await prisma.user.updateMany({
  where: { agencyId: agency.id, isDemo: true },
  data: { passwordHash, mustChangePassword: false, status: 'active' },
});
log(`Password set for ${users.length} demo accounts.`);

const campaign = await prisma.campaign.findFirstOrThrow({
  where: { agencyId: agency.id, name: CAMPAIGN },
});
if (await prisma.sale.count({ where: { campaignId: campaign.id } })) {
  log('The showcase data already exists (sales found). Nothing else to do.');
  await disconnectDatabase();
  process.exit(0);
}
const today = businessDate();
const start = addDays(today, -DAYS_BACK);
// Sign everybody in now, while the clock is real: the tokens last longer than this script.
for (const email of [DIRECTOR, REGIONAL, ...SUPERVISORS, ...ANIMATEURS, CLIENT]) await login(email);

// 2. Move the campaign back so it has been running for ten days.
const moved = campaign.startDate.toISOString().slice(0, 10) === start;
if (!moved)
  await prisma.$executeRaw`UPDATE campaign_status_history SET created_at = created_at - make_interval(days => ${DAYS_BACK + 1}) WHERE campaign_id = ${campaign.id}::uuid`;
await prisma.campaign.update({
  where: { id: campaign.id },
  data: { startDate: new Date(start), status: 'active' },
});
const ruleSet = await prisma.ruleSet.findFirstOrThrow({
  where: { campaignId: campaign.id, status: 'approved' },
});
await prisma.ruleSet.update({
  where: { id: ruleSet.id },
  data: { effectiveFrom: at(start, '00:00') },
});

// 3. Rules: sales and sampling targets, two gift promotions.
const base = { agencyId: agency.id, ruleSetId: ruleSet.id };
const stock = await prisma.stockItem.findMany({ where: { clientId: campaign.clientId } });
const item = (name) => stock.find((candidate) => candidate.name === name);
const products = await prisma.product.findMany({ where: { clientId: campaign.clientId } });
const product = (name) => products.find((candidate) => candidate.name === name);
for (const [ruleType, config] of [
  ['sales_target', { dailyUnitsPerAnimateur: 12, perProduct: [] }],
  ['sampling_target', { dailySamplesPerAnimateur: 30, stockItemId: item('Trial sachet').id }],
]) {
  const exists = await prisma.campaignRule.findFirst({
    where: { ruleSetId: ruleSet.id, ruleType },
  });
  if (!exists) await prisma.campaignRule.create({ data: { ...base, ruleType, config } });
}
for (const [name, productName, giftName, max] of [
  ['Buy detergent 1 kg, get mugs', 'Detergent 1 kg', 'Branded mug', 3],
  ['Buy detergent 3 kg, get tote bags', 'Detergent 3 kg', 'Tote bag', 2],
]) {
  if (await prisma.promotion.findFirst({ where: { ruleSetId: ruleSet.id, name } })) continue;
  await prisma.promotion.create({
    data: {
      ...base,
      name,
      type: 'tiered_gift',
      tiers: {
        create: Array.from({ length: max }, (_, index) => ({
          agencyId: agency.id,
          productId: product(productName).id,
          stockItemId: item(giftName).id,
          minQuantity: index + 1,
          giftQuantity: index + 1,
        })),
      },
    },
  });
}

// 4. Staff on the field: three Animateurs per supervisor, all approved and running since the start.
const staffRow = (email) => user(email);
const points = await prisma.campaignPointOfSale.findMany({
  where: { campaignId: campaign.id },
  include: { pointOfSale: true },
});
const pointOf = (name) => points.find((row) => row.pointOfSale.name === name).pointOfSale;
const plan = [
  ['animateur1@demo.test', 'supervisor1@demo.test', 'Demo Point de Vente 1'],
  ['animateur2@demo.test', 'supervisor1@demo.test', 'Demo Point de Vente 13'],
  ['animateur3@demo.test', 'supervisor1@demo.test', 'Demo Point de Vente 19'],
  ['animateur4@demo.test', 'supervisor2@demo.test', 'Demo Point de Vente 14'],
  ['animateur5@demo.test', 'supervisor2@demo.test', 'Demo Point de Vente 2'],
  ['animateur6@demo.test', 'supervisor2@demo.test', 'Demo Point de Vente 20'],
];
for (const [animateurEmail, supervisorEmail, pointName] of plan) {
  const animateur = staffRow(animateurEmail);
  const existing = await prisma.assignment.findFirst({
    where: { campaignId: campaign.id, animateurId: animateur.id },
  });
  const data = {
    startDate: new Date(start),
    endDate: new Date(addDays(today, 20)),
    status: 'approved',
    decidedById: staffRow(REGIONAL).id,
    decidedAt: at(start, '08:00'),
  };
  if (existing) await prisma.assignment.update({ where: { id: existing.id }, data });
  else
    await prisma.assignment.create({
      data: {
        ...data,
        agencyId: agency.id,
        campaignId: campaign.id,
        animateurId: animateur.id,
        supervisorId: staffRow(supervisorEmail).id,
        pointOfSaleId: pointOf(pointName).id,
        proposedById: staffRow(REGIONAL).id,
      },
    });
}
const assignments = await prisma.assignment.findMany({
  where: { campaignId: campaign.id, status: 'approved' },
});
const assignmentOf = (email) => assignments.find((row) => row.animateurId === staffRow(email).id);

// 5. The Tombola, open while the sales come in (entries are issued at each sale with consent).
const tombola =
  (await prisma.tombola.findFirst({ where: { campaignId: campaign.id } })) ??
  (await prisma.tombola.create({
    data: {
      agencyId: agency.id,
      campaignId: campaign.id,
      name: 'Grand Ramadan draw',
      entryBasis: 'per_sale',
      entriesPerBasis: 1,
      requiresPurchase: true,
      registrationEndsAt: new Date(Date.now() + 4 * 86_400_000),
      drawScheduledAt: new Date(Date.now() + 5 * 86_400_000),
      winnersCount: 3,
      reservesCount: 2,
    },
  }));

// 6. Stock: from the client to the warehouse, then down the chain to every Animateur.
setClock(start, '08:00');
const pairs = (names) => names.map((name) => ({ stockItemId: item(name).id }));
const lines = (quantities) =>
  Object.entries(quantities).map(([name, quantity]) => ({ stockItemId: item(name).id, quantity }));
const stockDone = (await prisma.stockMovement.count({ where: { campaignId: campaign.id } })) > 0;
async function seedStock() {
  await call(DIRECTOR, 'post', `/campaigns/${campaign.id}/stock/stock-in`, {
    body: {
      reference: 'BL-DEMO-001',
      lines: lines({ 'Branded mug': 900, 'Tote bag': 600, 'Key ring': 300, 'Trial sachet': 3000 }),
    },
  });
  async function move(from, to, quantities) {
    const out = await call(from, 'post', `/campaigns/${campaign.id}/stock/transfers`, {
      body: { recipientUserId: staffRow(to).id, lines: lines(quantities) },
    });
    await call(to, 'post', `/stock/transfers/${out.id}/confirm`, {
      body: {
        lines: Object.entries(quantities).map(([name, quantityReceived]) => ({
          stockItemId: item(name).id,
          quantityReceived,
        })),
      },
    });
  }
  await move(DIRECTOR, REGIONAL, { 'Branded mug': 900, 'Tote bag': 600, 'Key ring': 300 });
  for (const supervisor of SUPERVISORS)
    await move(REGIONAL, supervisor, { 'Branded mug': 450, 'Tote bag': 300, 'Key ring': 150 });
  for (const [animateurEmail, supervisorEmail] of plan)
    await move(supervisorEmail, animateurEmail, { 'Branded mug': 130, 'Tote bag': 90 });
  void pairs;
}
if (!stockDone) {
  await seedStock();
  log('Stock moved down the chain.');
}

// 7. Ten days of field work.
const names = [
  'Karim',
  'Amina',
  'Yacine',
  'Sofia',
  'Rachid',
  'Nadia',
  'Walid',
  'Lamia',
  'Samir',
  'Meriem',
  'Ali',
  'Imane',
];
const family = [
  'Benali',
  'Haddad',
  'Boukhari',
  'Mansouri',
  'Cherif',
  'Bensalem',
  'Zerrouki',
  'Ouali',
];
let customerNumber = 0;
const phone = () => {
  customerNumber += 1;
  return `05${[5, 6, 7][customerNumber % 3]}${String(1_000_000 + customerNumber * 7919).slice(0, 7)}`;
};
const hash = (text) =>
  [...text].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
const pick = (list, seed) => list[seed % list.length];
const visitPhotos = [];

for (let offset = -DAYS_BACK; offset <= 0; offset++) {
  const date = addDays(today, offset);
  const age = -offset;
  log(`Day ${date} (${age === 0 ? 'today' : age + ' days ago'})`);
  const dayStart = at(date, '00:00');
  const dayEnd = at(addDays(date, 1), '00:00');
  const between = { gte: dayStart, lt: dayEnd };
  const done = {
    attendance:
      (await prisma.attendanceRecord.count({
        where: { campaignId: campaign.id, workDate: new Date(date) },
      })) +
        (await prisma.absence.count({ where: { agencyId: agency.id, workDate: new Date(date) } })) >
      0,
    visits:
      (await prisma.supervisorVisit.count({
        where: { campaignId: campaign.id, visitedAt: between },
      })) > 0,
    sales:
      (await prisma.sale.count({ where: { campaignId: campaign.id, workDate: new Date(date) } })) >
      0,
    interactions:
      (await prisma.fieldInteraction.count({
        where: { campaignId: campaign.id, workDate: new Date(date) },
      })) > 0,
  };
  // Morning check-in with a photo.
  for (const email of done.attendance ? [] : ANIMATEURS) {
    const seed = hash(email + date);
    const assignment = assignmentOf(email);
    if (seed % 13 === 0 && age > 0) {
      setClock(date, '10:30');
      await tryCall(
        plan.find((row) => row[0] === email)[1],
        'post',
        `/assignments/${assignment.id}/absences`,
        {
          body: {
            workDate: date,
            type: seed % 2 ? 'justified' : 'unjustified',
            reason: 'Demo absence',
          },
        },
      );
      continue;
    }
    const late = seed % 7 === 0;
    setClock(date, late ? '09:40' : '08:45');
    await tryCall(email, 'post', `/assignments/${assignment.id}/attendance`, {
      fields: { checkpoint: 'morning' },
      files: [['photo', await photo(`Check-in ${email.split('@')[0]} ${date}`, seed)]],
    });
  }
  // Supervisor visits every other day, with two photos and sometimes an issue.
  if (age % 2 === 0 && !done.visits) {
    setClock(date, '11:15');
    for (const [index, supervisor] of SUPERVISORS.entries()) {
      const team = plan.filter((row) => row[1] === supervisor);
      const target = team[(age / 2) % team.length];
      const visit = await tryCall(supervisor, 'post', `/campaigns/${campaign.id}/visits`, {
        fields: {
          pointOfSaleId: pointOf(target[2]).id,
          observedAnimateurIds: JSON.stringify([staffRow(target[0]).id]),
          notes: age % 4 === 0 ? 'Shelf well stocked, display clean.' : 'Display needs more gifts.',
          ...(age === 4 && index === 0
            ? {
                issues: JSON.stringify([
                  { category: 'stock_shortage', title: 'Mugs running low at this store' },
                ]),
              }
            : {}),
        },
        files: [
          [
            'photos',
            await photo(
              `Visit ${target[2].replace('Demo Point de Vente', 'PDV')} ${date}`,
              age + index,
            ),
          ],
          ['photos', await photo(`Shelf ${date}`, age + index + 2)],
        ],
      });
      if (visit) visitPhotos.push(...visit.photos.map((row) => row.fileId));
    }
  }
  // Afternoon sales and sampling.
  setClock(date, '14:00');
  for (const email of done.sales && done.interactions ? [] : ANIMATEURS) {
    const assignment = assignmentOf(email);
    const seed = hash(email + date + 's');
    const count = 2 + (seed % 3);
    for (let index = 0; index < (done.sales ? 0 : count); index++) {
      const items = [
        { productId: pick(products, seed + index).id, quantity: 1 + ((seed + index) % 3) },
      ];
      const withPhone = (seed + index) % 4 !== 0;
      await tryCall(email, 'post', `/assignments/${assignment.id}/sales`, {
        body: {
          items,
          customer: {
            fullName: `${pick(names, seed + index * 3)} ${pick(family, seed + index * 5)}`,
            ...(withPhone ? { phone: phone(), consentTombola: true } : { consentTombola: false }),
          },
        },
      });
    }
    if (!done.interactions)
      await tryCall(email, 'post', `/assignments/${assignment.id}/interactions`, {
        body: { kind: 'sample', count: 12 + (seed % 25) },
      });
  }
  // Evening review: older check-ins are verified, the last two days stay pending, one is rejected.
  setClock(date, '18:00');
  const pending = await prisma.attendanceRecord.findMany({
    where: { campaignId: campaign.id, workDate: new Date(date), status: 'pending' },
  });
  if (age >= 2 && pending.length) {
    await tryCall(REGIONAL, 'post', `/campaigns/${campaign.id}/attendance/verify-bulk`, {
      body: { ids: pending.map(({ id }) => id) },
    });
  }
  if (age === 3 && pending[0])
    await tryCall(REGIONAL, 'post', `/attendance/${pending[0].id}/reject`, {
      body: { reason: 'The photo is blurry, please retake it tomorrow.' },
    });
}

// 8. Today: a few check-ins stay pending for the supervisor review demo (already the case), an
// issue from the field, an announcement, and three visit photos shared with the client.
setClock(today, '15:00');
const fieldDone =
  (await prisma.issue.count({ where: { campaignId: campaign.id } })) > 5 ||
  (await prisma.announcement.count({ where: { agencyId: agency.id, campaignId: campaign.id } })) >
    0;
if (!visitPhotos.length)
  visitPhotos.push(
    ...(
      await prisma.visitPhoto.findMany({
        where: { visit: { campaignId: campaign.id } },
        orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }],
        take: 3,
      })
    ).map((row) => row.fileId),
  );
const store = pointOf('Demo Point de Vente 1');
if (!fieldDone)
  await tryCall('animateur1@demo.test', 'post', '/issues', {
    body: {
      campaignId: campaign.id,
      pointOfSaleId: store.id,
      category: 'pos_problem',
      title: 'The store manager moved our display to the back',
      description: 'Customers cannot see the products from the entrance.',
    },
  });
if (!fieldDone)
  await tryCall(DIRECTOR, 'post', '/announcements', {
    body: {
      title: 'Welcome to the Ramadan campaign',
      body: 'Please send your check-in photo before 09:30 and record every sale in the app.',
      campaignId: campaign.id,
      targetRoles: ['supervisor', 'animateur', 'regional_manager'],
    },
  });
for (const fileId of visitPhotos.slice(0, 3))
  await tryCall(DIRECTOR, 'patch', `/files/${fileId}/visibility`, {
    body: { visibility: 'client_visible' },
  });

clock.now = realNow;
log('\nDone. Accounts (same password for all):');
for (const row of users.sort(
  (a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email),
))
  log(`  ${row.role.padEnd(17)} ${row.email}`);
void tombola;
await disconnectDatabase();
