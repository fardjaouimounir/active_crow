// Showcase data: a believable, entirely fictional agency (Algerian names, invented brands and shops)
// with two campaigns running right now, three weeks of history and today's activity up to the current
// hour. Everything that touches a ledger (attendance, sales, gift entitlements, stock, the Tombola,
// notifications) goes through the real API in-process, as each user and with a controlled clock, so
// the numbers stay consistent. Master data (people, stores, brands) is written directly.
//
//   npm run seed:showcase                      full run (safe to repeat: it tops up what is missing)
//   npm run seed:showcase -- --refresh-today   only today's activity up to now, history untouched
//
// Needs DEMO_PASSWORD in apps/api/.env. The agency is separate from the demo agency, so existing
// data is never modified. Accounts: see the table printed at the end (all use DEMO_PASSWORD).
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';

// Quiet logs (one line per request is too much here); the app modules read this when imported.
process.env.LOG_LEVEL ??= 'silent';
const { createApp } = await import('../../src/app.js');
const { buildUserActor } = await import('../../src/core/auth/actor.js');
const { hashPassword } = await import('../../src/core/auth/passwords.js');
const { signAccessToken } = await import('../../src/core/auth/tokens.js');
const { businessDate, clock } = await import('../../src/core/time/clock.js');
const { disconnectDatabase, prisma } = await import('../../src/db/client.js');
const { withTransaction } = await import('../../src/db/transaction.js');
const { insertDraftCampaign } = await import('../../src/modules/campaigns/campaigns.repository.js');
const { lifecycleService } = await import('../../src/modules/campaigns/lifecycle.service.js');
const { activateShowcase } = await import('./showcaseActivation.js');
const data = await import('./showcaseData.js');

const realNow = clock.now;
const REFRESH_TODAY = process.argv.includes('--refresh-today');
const AGENCY_CODE = process.env.SHOWCASE_AGENCY ?? data.AGENCY.code;
const password = process.env.DEMO_PASSWORD?.trim();
if (!password) throw new Error('Set DEMO_PASSWORD in apps/api/.env');
if (process.env.NODE_ENV === 'production')
  throw new Error('The showcase seed is disabled in production');
if (!/^(ACTICREW|SHOWCASE)[A-Z0-9-]*$/.test(AGENCY_CODE))
  throw new Error(
    'SHOWCASE_AGENCY must start with ACTICREW or SHOWCASE: this seed never writes into another agency',
  );

const app = createApp();
app.set('trust proxy', true); // seed only: each simulated user gets their own address (rate limit)
const log = (message) => process.stdout.write(message + '\n');

// ─── Time ────────────────────────────────────────────────────────────────────

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
const toHHMM = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const today = businessDate(realNow());
// SHOWCASE_NOW=14:30 pretends it is that time of day today (handy for screenshots at night).
const nowHHMM =
  process.env.SHOWCASE_NOW ?? new Date(+realNow() + 3_600_000).toISOString().slice(11, 16);

// ─── Deterministic randomness: the same data on every run ───────────────────

function rand(key) {
  const digest = createHash('sha1').update(String(key)).digest();
  return digest.readUInt32BE(0) / 4_294_967_296;
}
const pick = (list, key) => list[Math.floor(rand(key) * list.length)];

// ─── HTTP as a given user ────────────────────────────────────────────────────

// Access tokens are minted at the simulated time (they live 15 minutes of simulated time), so the
// seed never hits the login rate limit however far the clock jumps.
const accounts = new Map();
const addressOf = (email) => {
  const digest = createHash('sha1').update(email).digest();
  return `10.${digest[0]}.${digest[1]}.${digest[2]}`;
};
async function tokenFor(email) {
  if (!accounts.has(email)) {
    const row = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        id: true,
        agencyId: true,
        role: true,
        clientId: true,
        tokenVersion: true,
        mustChangePassword: true,
      },
    });
    accounts.set(email, row);
  }
  return (await signAccessToken(accounts.get(email))).accessToken;
}
let failures = 0;
async function call(email, method, path, { body, fields, files, json = true } = {}) {
  const token = await tokenFor(email);
  const req = request(app)
    [method]('/api/v1' + path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Forwarded-For', addressOf(email));
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
      `${email.split('@')[0]} ${method.toUpperCase()} ${path.replace(/[0-9a-f-]{36}/g, ':id')} → ${res.status} ${res.body?.error?.code ?? ''}`,
    );
    error.status = res.status;
    error.code = res.body?.error?.code;
    if (res.status >= 500) error.message += ' ' + JSON.stringify(res.body).slice(0, 300);
    throw error;
  }
  return json ? res.body.data : res.body;
}
const seen = new Set();
async function tryCall(...args) {
  try {
    return await call(...args);
  } catch (error) {
    failures += 1;
    if (!seen.has(error.message)) {
      seen.add(error.message);
      log(`  ! ${error.message}`);
    }
    return null;
  }
}

// ─── Photos (Latin text only: the SVG renderer has no Arabic font guarantee) ─

const PALETTES = [
  ['#1f3b4d', '#2f6f8f'],
  ['#3d2b1f', '#8f5a2f'],
  ['#1f3d2b', '#3d8f4f'],
  ['#2e1f3d', '#7a3d8f'],
  ['#3d1f26', '#8f3d4a'],
  ['#1f2a3d', '#4a5a8f'],
];
async function photo(label, sublabel, index = 0) {
  const [from, to] = PALETTES[index % PALETTES.length];
  const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = Buffer.from(
    `<svg width="640" height="420" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><rect x="40" y="250" width="560" height="110" rx="10" fill="#ffffff22"/><circle cx="320" cy="150" r="52" fill="#ffffff2e"/><text x="320" y="300" font-size="30" fill="white" text-anchor="middle" font-family="sans-serif">${esc(label)}</text><text x="320" y="338" font-size="20" fill="#ffffffcc" text-anchor="middle" font-family="sans-serif">${esc(sublabel)}</text></svg>`,
  );
  return sharp(svg).jpeg({ quality: 78 }).toBuffer();
}

// ─── Setup: master data ──────────────────────────────────────────────────────

const passwordHash = await hashPassword(password);
const emailOf = (key) => `${key}@${data.EMAIL_DOMAIN}`;

async function ensureAgency() {
  return prisma.agency.upsert({
    where: { code: AGENCY_CODE },
    update: { name: data.AGENCY.name },
    create: { code: AGENCY_CODE, name: data.AGENCY.name },
  });
}

async function ensureUser(agency, spec) {
  const email = emailOf(spec.emailKey);
  const common = {
    fullName: spec.name,
    role: spec.role,
    wilayaId: spec.wilayaId ?? null,
    clientId: spec.clientId ?? null,
    phone: spec.phone ?? null,
    passwordHash,
    mustChangePassword: false,
    status: 'active',
    isDemo: true,
  };
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.agencyId !== agency.id) throw new Error(`${email} belongs to another agency`);
    return prisma.user.update({ where: { id: existing.id }, data: common });
  }
  return prisma.user.create({
    data: {
      ...common,
      agencyId: agency.id,
      email,
      animateurProfile:
        spec.role === 'animateur'
          ? {
              create: {
                agencyId: agency.id,
                skills: [],
                languages: ['ar', 'fr'],
                experienceYears: 1 + Math.floor(rand(email) * 6),
              },
            }
          : undefined,
    },
  });
}

async function ensureReportingLine(agency, user, manager, validFrom) {
  if (await prisma.reportingLine.count({ where: { userId: user.id, managerId: manager.id } }))
    return;
  await prisma.reportingLine.create({
    data: { agencyId: agency.id, userId: user.id, managerId: manager.id, validFrom },
  });
}

async function setupOrganization(agency) {
  const history = new Date(addDays(today, -60));
  const staff = {};
  for (const [key, spec] of Object.entries(data.STAFF))
    staff[key] = await ensureUser(agency, { ...spec, emailKey: spec.email });
  await ensureReportingLine(agency, staff.general, staff.director, history);
  for (const key of ['centre', 'est'])
    await ensureReportingLine(agency, staff[key], staff.general, history);
  const regionOfSupervisor = { S1: 'centre', S2: 'centre', S3: 'est', S4: 'est' };
  for (const [key, region] of Object.entries(regionOfSupervisor))
    await ensureReportingLine(agency, staff[key], staff[region], history);

  for (const region of data.REGIONS) {
    const row = await prisma.region.upsert({
      where: { agencyId_code: { agencyId: agency.id, code: region.code } },
      update: { name: region.name },
      create: { agencyId: agency.id, code: region.code, name: region.name, isDemo: true },
    });
    for (const wilayaId of region.wilayas)
      await prisma.regionWilaya.upsert({
        where: { agencyId_wilayaId: { agencyId: agency.id, wilayaId } },
        update: {},
        create: { agencyId: agency.id, wilayaId, regionId: row.id },
      });
  }

  const animateurs = {};
  for (const [emailKey, name, wilayaId, group] of data.ANIMATEURS) {
    const user = await ensureUser(agency, {
      emailKey,
      name,
      role: 'animateur',
      wilayaId,
      phone: `0${[5, 6, 7][Math.floor(rand(emailKey) * 3)]}${String(10_000_000 + Math.floor(rand(emailKey + 'p') * 89_999_999))}`,
    });
    await ensureReportingLine(agency, user, staff[data.WILAYA_PLAN[wilayaId][1]], history);
    animateurs[emailKey] = { user, group };
  }

  const stores = {};
  for (const [code, name, type, wilayaId, latitude, longitude] of data.STORES) {
    stores[code] = await prisma.pointOfSale.upsert({
      where: { agencyId_code: { agencyId: agency.id, code } },
      update: { name, type, wilayaId, latitude, longitude },
      create: {
        agencyId: agency.id,
        code,
        name,
        type,
        wilayaId,
        latitude,
        longitude,
        contactName: pick(data.FIRST_NAMES, code) + ' ' + pick(data.FAMILY_NAMES, code + 'f'),
        isDemo: true,
      },
    });
  }
  return { staff, animateurs, stores };
}

async function setupClient(agency, key) {
  const spec = data.CLIENTS[key];
  const client =
    (await prisma.client.findFirst({
      where: { agencyId: agency.id, name: spec.name, deletedAt: null },
    })) ??
    (await prisma.client.create({
      data: {
        agencyId: agency.id,
        name: spec.name,
        legalName: spec.legalName,
        contactName: spec.contactName,
        contactEmail: emailOf(spec.portal.email),
      },
    }));
  const products = [];
  for (const [sku, name, unitLabel, referencePrice] of spec.products)
    products.push(
      await prisma.product.upsert({
        where: { clientId_sku: { clientId: client.id, sku } },
        update: { name, unitLabel, referencePrice },
        create: { agencyId: agency.id, clientId: client.id, sku, name, unitLabel, referencePrice },
      }),
    );
  const items = [];
  for (const [kind, sku, name, unitLabel] of spec.stock)
    items.push(
      await prisma.stockItem.upsert({
        where: { clientId_sku: { clientId: client.id, sku } },
        update: { name, unitLabel },
        create: { agencyId: agency.id, clientId: client.id, kind, sku, name, unitLabel },
      }),
    );
  await ensureUser(agency, {
    emailKey: spec.portal.email,
    name: spec.portal.name,
    role: 'client',
    clientId: client.id,
  });
  return { client, products, gifts: items.filter((i) => i.kind === 'gift'), sample: items[2] };
}

const scopeOf = (agency) => ({ level: 'agency', agencyId: agency.id });

async function createDraft(agency, director, clientId, spec) {
  const startDate = addDays(today, spec.startOffset);
  const endDate = addDays(today, spec.endOffset);
  return withTransaction((tx) =>
    insertDraftCampaign(
      tx,
      scopeOf(agency),
      {
        clientId,
        name: spec.name,
        description: spec.description,
        startDate,
        endDate,
        budgetAmount: spec.budget,
      },
      director.id,
    ),
  );
}

async function setupCampaign(agency, org, spec) {
  const catalog = await setupClient(agency, spec.client);
  let campaign = await prisma.campaign.findFirst({
    where: { agencyId: agency.id, name: spec.name },
  });
  const start = addDays(today, spec.startOffset);
  const isNew = !campaign;
  if (isNew) {
    const draft = await createDraft(agency, org.staff.director, catalog.client.id, spec);
    campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: draft.id } });
  }
  const base = { agencyId: agency.id, campaignId: campaign.id };
  const wilayaIds = Object.keys(spec.requiredPerWilaya).map(Number);

  await prisma.campaignWilaya.createMany({
    data: wilayaIds.map((wilayaId) => ({
      ...base,
      wilayaId,
      requiredAnimateurs: spec.requiredPerWilaya[wilayaId],
    })),
    skipDuplicates: true,
  });
  await prisma.campaignStaff.createMany({
    data: wilayaIds.flatMap((wilayaId) => {
      const [region, supervisor] = data.WILAYA_PLAN[wilayaId];
      return [
        { ...base, wilayaId, role: 'regional_manager', userId: org.staff[region].id },
        { ...base, wilayaId, role: 'supervisor', userId: org.staff[supervisor].id },
      ];
    }),
    skipDuplicates: true,
  });
  await prisma.campaignPointOfSale.createMany({
    data: data.CAMPAIGN_STORES[spec.key].map((code) => ({
      ...base,
      pointOfSaleId: org.stores[code].id,
    })),
    skipDuplicates: true,
  });
  await prisma.campaignProduct.createMany({
    data: catalog.products.map((product) => ({ ...base, productId: product.id })),
    skipDuplicates: true,
  });

  // Rules → approved rule set effective from the start.
  const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const ruleBase = { agencyId: agency.id, ruleSetId: ruleSet.id };
  {
    const rules = [
      [
        'attendance',
        {
          checkpoints: [
            {
              code: 'morning',
              label: { ar: 'الحضور الصباحي', en: 'Morning check-in' },
              window: ['08:30', '11:00'],
              photo: true,
              gps: true,
            },
            {
              code: 'closing',
              label: { ar: 'إغلاق اليوم', en: 'Closing' },
              window: ['17:00', '20:00'],
              photo: true,
              gps: false,
            },
          ],
          lateToleranceMinutes: 15,
          autoVerifyAfterHours: null,
          maxDistanceMeters: 150,
        },
      ],
      ['customer_fields', { fullName: 'required', phone: 'optional', consentRequired: false }],
      [
        'sales_target',
        { dailyUnitsPerAnimateur: spec.targets.dailyUnitsPerAnimateur, perProduct: [] },
      ],
      [
        'sampling_target',
        {
          dailySamplesPerAnimateur: spec.targets.dailySamplesPerAnimateur,
          stockItemId: catalog.sample.id,
        },
      ],
    ];
    for (const [ruleType, config] of rules)
      if (!(await prisma.campaignRule.findFirst({ where: { ruleSetId: ruleSet.id, ruleType } })))
        await prisma.campaignRule.create({ data: { ...ruleBase, ruleType, config } });
    const [productA, productB] = catalog.products;
    for (const [index, product] of [productA, productB].entries()) {
      const name = `${product.name} + ${catalog.gifts[index].name}`;
      if (await prisma.promotion.findFirst({ where: { ruleSetId: ruleSet.id, name } })) continue;
      await prisma.promotion.create({
        data: {
          ...ruleBase,
          name,
          type: 'tiered_gift',
          tiers: {
            create: Array.from({ length: spec.giftPlan.tierMax }, (_, tier) => ({
              agencyId: agency.id,
              productId: product.id,
              stockItemId: catalog.gifts[index].id,
              minQuantity: tier + 1,
              giftQuantity: tier + 1,
            })),
          },
        },
      });
    }
    if (ruleSet.status !== 'approved')
      await prisma.ruleSet.update({
        where: { id: ruleSet.id },
        data: {
          status: 'approved',
          approvedById: org.staff.director.id,
          approvedAt: at(start, '00:00'),
          effectiveFrom: at(start, '00:00'),
        },
      });
  }

  // Staff on the field: approved assignments, plus pending proposals.
  const supervisorOf = (wilayaId) => org.staff[data.WILAYA_PLAN[wilayaId][1]];
  const regionalOf = (wilayaId) => org.staff[data.WILAYA_PLAN[wilayaId][0]];
  for (const [emailKey, , wilayaId, group, storeCode] of data.ANIMATEURS) {
    if (group !== spec.key && !(group === 'proposed' && spec.key === 'nedjma')) continue;
    const animateur = org.animateurs[emailKey].user;
    // Every Animateur of the campaign belongs to the team of his supervisor.
    await prisma.campaignAnimateur.createMany({
      data: [
        {
          ...base,
          supervisorId: supervisorOf(wilayaId).id,
          animateurId: animateur.id,
          addedById: supervisorOf(wilayaId).id,
        },
      ],
      skipDuplicates: true,
    });
    if (
      await prisma.assignment.count({
        where: { campaignId: campaign.id, animateurId: animateur.id },
      })
    )
      continue;
    const approved = group !== 'proposed';
    await prisma.assignment.create({
      data: {
        ...base,
        animateurId: animateur.id,
        supervisorId: supervisorOf(wilayaId).id,
        pointOfSaleId: org.stores[storeCode].id,
        proposedById: supervisorOf(wilayaId).id,
        startDate: new Date(approved ? start : addDays(today, 1)),
        endDate: new Date(addDays(today, spec.endOffset)),
        workDays: [1, 2, 3, 4, 5, 6, 7],
        status: approved ? 'approved' : 'proposed',
        decidedById: approved ? regionalOf(wilayaId).id : null,
        decidedAt: approved ? at(start, '08:00') : null,
      },
    });
  }

  // The quota of a supervisor is the size of his team; the wilaya need is the sum of its quotas.
  for (const wilayaId of wilayaIds) {
    const supervisorId = supervisorOf(wilayaId).id;
    const members = await prisma.campaignAnimateur.count({
      where: { campaignId: campaign.id, supervisorId },
    });
    await prisma.campaignStaff.updateMany({
      where: { campaignId: campaign.id, wilayaId, userId: supervisorId, role: 'supervisor' },
      data: { requiredAnimateurs: members },
    });
    await prisma.campaignWilaya.update({
      where: { campaignId_wilayaId: { campaignId: campaign.id, wilayaId } },
      data: { requiredAnimateurs: members },
    });
  }

  if (isNew || campaign.status !== 'active') {
    try {
      await activateShowcase(campaign, org.staff.director, start);
    } catch (error) {
      log(`  ! activation of "${spec.name}": ${error.message}`);
      throw error;
    }
  }

  if (spec.tombola && !(await prisma.tombola.findFirst({ where: { campaignId: campaign.id } })))
    await prisma.tombola.create({
      data: {
        ...base,
        name: spec.tombola.name,
        entryBasis: 'per_sale',
        entriesPerBasis: 1,
        requiresPurchase: true,
        registrationEndsAt: at(addDays(today, 6), '23:59'),
        drawScheduledAt: at(addDays(today, 8), '18:00'),
        winnersCount: spec.tombola.winners,
        reservesCount: spec.tombola.reserves,
      },
    });
  return { ...spec, clientKey: spec.client, row: campaign, ...catalog };
}

/** A planned campaign and a draft, so the campaigns list shows every state. */
async function setupFutureCampaigns(agency, org, campaigns) {
  const plans = [
    {
      client: 'nedjma',
      name: 'حملة تذوق رمضان — قهوة نجمة',
      description: 'حملة موسمية للتذوق خلال شهر رمضان في المساحات الكبرى بالمدن الكبرى.',
      startDate: addDays(today, 78),
      endDate: addDays(today, 108),
      budget: '3100000.00',
      wilayas: { 16: 6, 31: 4, 25: 3 },
      plan: true,
    },
    {
      client: 'nour',
      name: 'Lancement Yaourt Nour — Printemps',
      description: 'Deuxième vague de la gamme Nour : cap sur les Hauts-Plateaux et le Sud.',
      startDate: addDays(today, 120),
      endDate: addDays(today, 160),
      budget: '1200000.00',
      wilayas: {},
      plan: false,
    },
  ];
  for (const plan of plans) {
    if (await prisma.campaign.findFirst({ where: { agencyId: agency.id, name: plan.name } }))
      continue;
    const owner = campaigns.find((c) => c.clientKey === plan.client);
    const campaign = await withTransaction((tx) =>
      insertDraftCampaign(
        tx,
        scopeOf(agency),
        {
          clientId: owner.client.id,
          name: plan.name,
          description: plan.description,
          startDate: plan.startDate,
          endDate: plan.endDate,
          budgetAmount: plan.budget,
        },
        org.staff.director.id,
      ),
    );
    const base = { agencyId: agency.id, campaignId: campaign.id };
    await prisma.campaignWilaya.createMany({
      data: Object.entries(plan.wilayas).map(([wilayaId, requiredAnimateurs]) => ({
        ...base,
        wilayaId: Number(wilayaId),
        requiredAnimateurs,
      })),
    });
    await prisma.campaignProduct.createMany({
      data: owner.products.map((product) => ({ ...base, productId: product.id })),
    });
    if (plan.plan)
      await lifecycleService.transition(
        scopeOf(agency),
        buildUserActor(org.staff.director),
        campaign.id,
        'plan',
      );
  }
}

// ─── Stock: client → warehouse → regional → supervisor → animateur ──────────

async function distributeStock(campaign, org) {
  if (await prisma.stockMovement.count({ where: { campaignId: campaign.row.id } })) return;
  const D = emailOf(data.STAFF.director.email);
  const email = (user) => user.email;
  const itemLines = (per) =>
    campaign.gifts.map((gift, index) => ({ stockItemId: gift.id, quantity: per[index] }));
  const assigned = data.ANIMATEURS.filter(([, , , group]) => group === campaign.key);
  const perAnimateur = campaign.giftPlan.perAnimateur;

  // One transfer, confirmed by the recipient (optionally receiving less: a dispute).
  async function move(from, to, lines, received) {
    const out = await tryCall(from, 'post', `/campaigns/${campaign.row.id}/stock/transfers`, {
      body: { recipientUserId: to.id, lines },
    });
    if (!out) return null;
    await tryCall(email(to), 'post', `/stock/transfers/${out.id}/confirm`, {
      body: {
        lines: lines.map((line) => ({
          stockItemId: line.stockItemId,
          quantityReceived: received?.[line.stockItemId] ?? line.quantity,
        })),
      },
    });
    return out;
  }

  const regionOf = { S1: 'centre', S2: 'centre', S3: 'est', S4: 'est' };
  const forAnimateur = ([emailKey, , , , , factor]) => {
    const scarce = emailKey === 'hamza.belhadj'; // runs out of gifts: a stock shortage
    return itemLines(perAnimateur).map((line) => ({
      ...line,
      quantity: scarce ? 55 : Math.round(line.quantity * Math.max(0.6, Math.min(factor, 1.4))),
    }));
  };
  const addLines = (lines, other, spare = 0) =>
    lines.map((line, index) => ({
      ...line,
      quantity: line.quantity + other[index].quantity + spare,
    }));
  const zero = () => itemLines([0, 0]);
  const supervisorLines = new Map();
  for (const row of assigned) {
    const supervisor = data.WILAYA_PLAN[row[2]][1];
    const base = supervisorLines.get(supervisor) ?? addLines(zero(), zero(), 40);
    supervisorLines.set(supervisor, addLines(base, forAnimateur(row)));
  }
  const regionalLines = new Map();
  for (const [supervisor, lines] of supervisorLines) {
    const region = regionOf[supervisor];
    const base = regionalLines.get(region) ?? addLines(zero(), zero(), 100);
    regionalLines.set(region, addLines(base, lines));
  }
  const total = [...regionalLines.values()].reduce(
    (acc, lines) => acc.map((n, i) => n + lines[i].quantity),
    [0, 0],
  );
  setClock(addDays(today, campaign.startOffset), '08:10');
  await tryCall(D, 'post', `/campaigns/${campaign.row.id}/stock/stock-in`, {
    body: {
      reference: `BL-${campaign.key.toUpperCase()}-001`,
      lines: [
        ...campaign.gifts.map((gift, index) => ({
          stockItemId: gift.id,
          quantity: Math.round(total[index] * 1.12),
        })),
        { stockItemId: campaign.sample.id, quantity: 6000 },
      ],
    },
  });
  setClock(addDays(today, campaign.startOffset), '09:00');
  for (const [region, lines] of regionalLines) await move(D, org.staff[region], lines);
  for (const [supervisor, lines] of supervisorLines)
    await move(emailOf(data.STAFF[regionOf[supervisor]].email), org.staff[supervisor], lines);
  for (const row of assigned) {
    const [emailKey, , wilayaId] = row;
    const lines = forAnimateur(row);
    const received =
      emailKey === 'ikram.ouartsi'
        ? Object.fromEntries(lines.map((line) => [line.stockItemId, line.quantity - 12]))
        : undefined; // one transfer arrives short and stays disputed
    const supervisor = emailOf(data.STAFF[data.WILAYA_PLAN[wilayaId][1]].email);
    await move(supervisor, org.animateurs[emailKey].user, lines, received);
  }
  log(`  stock moved down the chain for "${campaign.name}"`);
}

// ─── Daily field activity ────────────────────────────────────────────────────

const customerNames = () => [data.FIRST_NAMES, data.FAMILY_NAMES];
let phoneCounter = 0;
const phone = () => {
  phoneCounter += 1;
  return `0${[5, 6, 7][phoneCounter % 3]}${String(10_000_000 + ((phoneCounter * 7919 * 13) % 89_999_999))}`;
};

/** Coordinates a few metres around the store (or far away when `far`). */
function nearby(store, key, far = false) {
  const spread = far ? 0.012 : 0.0004;
  return {
    latitude: Number(store.latitude) + (rand(key + 'a') - 0.5) * spread * 2,
    longitude: Number(store.longitude) + (rand(key + 'b') - 0.5) * spread * 2,
  };
}

/**
 * Runs one working day for every active assignment up to `limit` (HH:MM). Every action is skipped if
 * it already exists, so the same call can top up today again and again.
 */
async function runDay(ctx, date, limit) {
  const age = Math.round((+new Date(date) - +new Date(today)) / -86_400_000);
  const assignments = await prisma.assignment.findMany({
    where: {
      agencyId: ctx.agency.id,
      status: 'approved',
      startDate: { lte: new Date(date) },
      endDate: { gte: new Date(date) },
    },
  });
  if (!assignments.length) return;
  const campaignByRow = new Map(ctx.campaigns.map((c) => [c.row.id, c]));
  const emailKeyOf = new Map(
    Object.entries(ctx.org.animateurs).map(([key, { user }]) => [user.id, key]),
  );
  const factorOf = new Map(data.ANIMATEURS.map((row) => [row[0], row[5]]));
  const storeById = new Map(Object.values(ctx.org.stores).map((s) => [s.id, s]));
  const staffById = new Map(Object.values(ctx.org.staff).map((u) => [u.id, u]));
  const day = new Date(date);
  const [records, absences, sales, interactions] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { workDate: day, agencyId: ctx.agency.id } }),
    prisma.absence.findMany({ where: { workDate: day, agencyId: ctx.agency.id, voidedAt: null } }),
    prisma.sale.groupBy({
      by: ['animateurId'],
      where: { workDate: day, agencyId: ctx.agency.id },
      _count: true,
    }),
    prisma.fieldInteraction.groupBy({
      by: ['animateurId'],
      where: { workDate: day, agencyId: ctx.agency.id },
      _count: true,
    }),
  ]);
  const salesDone = new Map(sales.map((row) => [row.animateurId, row._count]));
  const interactionsDone = new Set(interactions.map((row) => row.animateurId));
  const limitMinutes = minutesOf(limit);
  const due = (hhmm) => minutesOf(hhmm) <= limitMinutes;

  for (const assignment of assignments) {
    const key = emailKeyOf.get(assignment.animateurId);
    if (!key) continue;
    const campaign = campaignByRow.get(assignment.campaignId);
    if (!campaign) continue;
    const email = emailOf(key);
    const store = storeById.get(assignment.pointOfSaleId);
    const supervisorEmail = staffById.get(assignment.supervisorId).email;
    const id = assignment.id;
    const seed = `${key}${date}`;
    const factor = factorOf.get(key) ?? 1;
    const hasRecord = (checkpoint) =>
      records.some((r) => r.assignmentId === id && r.checkpoint === checkpoint);
    const absent =
      absences.some((a) => a.assignmentId === id) ||
      (age > 0 && rand(seed + 'abs') < (factor < 0.5 ? 0.16 : 0.045));

    // Morning check-in (with GPS and a photo), or the absence the supervisor records at 10:30.
    const late = rand(seed + 'late') < 0.2;
    const minute = late
      ? 8 * 60 + 50 + Math.floor(rand(seed + 'lm') * 65)
      : 8 * 60 + 30 + Math.floor(rand(seed + 'om') * 14);
    const checkin = toHHMM(minute);
    if (!hasRecord('morning') && !absences.some((a) => a.assignmentId === id)) {
      if (absent && age > 0) {
        if (due('10:30')) {
          setClock(date, '10:30');
          const justified = rand(seed + 'j') < 0.6;
          await tryCall(supervisorEmail, 'post', `/assignments/${id}/absences`, {
            body: {
              workDate: date,
              type: justified ? 'justified' : 'unjustified',
              ...(justified ? { reason: pick(data.ABSENCE_REASONS, seed) } : {}),
            },
          });
        }
        continue;
      }
      const notSent = age === 0 && rand(seed + 'ns') < 0.1;
      if (!notSent && due(checkin)) {
        setClock(date, checkin);
        const far = (key === 'ikram.ouartsi' && age === 3) || (key === 'meriem.hamdi' && age === 0);
        const accuracy =
          key === 'sofiane.laribi' && age === 1 ? 190 : 6 + Math.floor(rand(seed + 'g') * 30);
        await tryCall(email, 'post', `/assignments/${id}/attendance`, {
          fields: {
            checkpoint: 'morning',
            ...Object.fromEntries(
              Object.entries(nearby(store, seed, far)).map(([k, v]) => [k, v.toFixed(6)]),
            ),
            gpsAccuracyM: String(accuracy),
          },
          files: [
            [
              'photo',
              await photo(
                `Check-in ${store.code}`,
                `${key.split('.')[0]} · ${date} ${checkin}`,
                minute,
              ),
            ],
          ],
        });
      }
    }
    if (absent && age > 0) continue;

    // Sales through the day, with gifts handed over on the spot.
    const count = Math.max(0, Math.round(factor * (2 + 3 * rand(seed + 'n'))));
    const done = salesDone.get(assignment.animateurId) ?? 0;
    for (let index = done; index < count; index++) {
      const minute = 10 * 60 + Math.floor(((index + rand(`${seed}t${index}`)) / count) * 510);
      if (minute > limitMinutes) break;
      setClock(date, toHHMM(minute));
      const product = pick(campaign.products, `${seed}p${index}`);
      const withPhone = rand(`${seed}ph${index}`) < 0.78;
      const [firsts, families] = customerNames();
      const sale = await tryCall(email, 'post', `/assignments/${id}/sales`, {
        body: {
          items: [
            { productId: product.id, quantity: 1 + Math.floor(rand(`${seed}q${index}`) * 3) },
          ],
          customer: {
            fullName: `${pick(firsts, `${seed}f${index}`)} ${pick(families, `${seed}l${index}`)}`,
            ...(withPhone ? { phone: phone(), consentTombola: true } : { consentTombola: false }),
          },
        },
      });
      void sale;
    }
    if (!interactionsDone.has(assignment.animateurId) && due('12:20')) {
      setClock(date, '12:20');
      await tryCall(email, 'post', `/assignments/${id}/interactions`, {
        body: {
          kind: 'sample',
          count: Math.max(6, Math.round(factor * (14 + rand(seed + 's') * 30))),
        },
      });
    }

    // Closing check-in (photo) once the shift ends.
    const closeAt = toHHMM(17 * 60 + 10 + Math.floor(rand(seed + 'cl') * 80));
    if (!hasRecord('closing') && due(closeAt) && rand(seed + 'noclose') > 0.07) {
      setClock(date, closeAt);
      await tryCall(email, 'post', `/assignments/${id}/attendance`, {
        fields: { checkpoint: 'closing' },
        files: [
          [
            'photo',
            await photo(
              `Closing ${store.code}`,
              `${key.split('.')[0]} · ${date} ${closeAt}`,
              minute + 2,
            ),
          ],
        ],
      });
    }
  }

  // Review: older days are verified; the last two days keep a queue; one photo is rejected.
  if (age >= 1 && due('19:30')) {
    setClock(date, '19:45');
    const pending = await prisma.attendanceRecord.findMany({
      where: { agencyId: ctx.agency.id, workDate: day, status: 'pending' },
      orderBy: { id: 'asc' },
    });
    const director = emailOf(data.STAFF.director.email);
    const rejected = age === 4 ? pending[0] : null;
    if (rejected)
      await tryCall(director, 'post', `/attendance/${rejected.id}/reject`, {
        body: { reason: 'الصورة غير واضحة، يرجى إعادة التقاط الصورة غدًا.' },
      });
    const verify = pending.filter(
      (row) => row !== rejected && (age >= 3 || rand(row.id) < (age === 2 ? 0.7 : 0.4)),
    );
    for (const [campaignId, rows] of Map.groupBy(verify, (row) => row.campaignId))
      await tryCall(director, 'post', `/campaigns/${campaignId}/attendance/verify-bulk`, {
        body: { ids: rows.map((row) => row.id) },
      });
  }
}

// ─── One-off field stories (each guarded so reruns do not duplicate) ────────

async function supervisorVisits(ctx, date, age) {
  if (age < 1 || age % 2 !== 0) return;
  const day = new Date(date);
  if (
    await prisma.supervisorVisit.count({
      where: {
        agencyId: ctx.agency.id,
        visitedAt: { gte: at(date, '00:00'), lt: at(addDays(date, 1), '00:00') },
      },
    })
  )
    return;
  for (const key of ['S1', 'S2', 'S3', 'S4']) {
    const supervisor = ctx.org.staff[key];
    const team = await prisma.assignment.findMany({
      where: {
        supervisorId: supervisor.id,
        status: 'approved',
        startDate: { lte: day },
        endDate: { gte: day },
      },
      orderBy: { id: 'asc' },
    });
    if (!team.length) continue;
    const target = team[Math.floor(age / 2) % team.length];
    const store = Object.values(ctx.org.stores).find((s) => s.id === target.pointOfSaleId);
    setClock(date, '11:20');
    const notes = [
      'Linéaire bien approvisionné, stand propre.',
      'الركن منظم والهدايا في متناول الزبائن.',
      'Il faut ajouter des cadeaux avant le week-end.',
      'الفريق يحتاج إلى دعم إضافي بعد الظهر.',
    ];
    await tryCall(
      emailOf(data.STAFF[key].email),
      'post',
      `/campaigns/${target.campaignId}/visits`,
      {
        fields: {
          pointOfSaleId: target.pointOfSaleId,
          observedAnimateurIds: JSON.stringify([target.animateurId]),
          notes: pick(notes, key + date),
          latitude: Number(store.latitude).toFixed(6),
          longitude: Number(store.longitude).toFixed(6),
        },
        files: [
          ['photos', await photo(`Visit ${store.code}`, `${key} · ${date}`, age)],
          ['photos', await photo(`Shelf ${store.code}`, date, age + 3)],
        ],
      },
    );
  }
}

async function absenceWithReplacement(ctx) {
  const weak = ctx.org.animateurs['abdelkader.touati'].user;
  const successor = ctx.org.animateurs['lamine.guerrouj']?.user;
  if (!successor) return;
  const original = await prisma.assignment.findFirst({
    where: { animateurId: weak.id, status: 'approved' },
  });
  if (
    !original ||
    (await prisma.assignment.count({ where: { replacesAssignmentId: original.id } }))
  )
    return;
  const supervisorEmail = emailOf(data.STAFF.S4.email);
  const replacement = await tryCall(
    supervisorEmail,
    'post',
    `/assignments/${original.id}/replace`,
    {
      body: {
        animateurId: successor.id,
        fromDate: addDays(today, -4),
        reason: 'غياب متكرر — تعويض بزميل من نفس الولاية',
      },
    },
  );
  if (replacement?.id && replacement.status === 'proposed')
    await tryCall(emailOf(data.STAFF.est.email), 'post', `/assignments/${replacement.id}/approve`, {
      body: {},
    });
}

async function issues(ctx) {
  for (const spec of data.ISSUES) {
    if (await prisma.issue.findFirst({ where: { agencyId: ctx.agency.id, title: spec.title } }))
      continue;
    const campaign = ctx.campaigns.find((c) => c.key === spec.campaign);
    const reporter = ctx.org.animateurs[spec.by].user;
    const assignment = await prisma.assignment.findFirst({
      where: { animateurId: reporter.id, campaignId: campaign.row.id, status: 'approved' },
    });
    if (!assignment) continue;
    const date = addDays(today, -spec.age);
    setClock(date, '14:10');
    const created = await tryCall(emailOf(spec.by), 'post', '/issues', {
      body: {
        campaignId: campaign.row.id,
        pointOfSaleId: assignment.pointOfSaleId,
        category: spec.category,
        title: spec.title,
        description: spec.description,
        ...(spec.category === 'stock_shortage' ? { stockItemId: campaign.gifts[0].id } : {}),
      },
    });
    if (!created || spec.flow === 'open') continue;
    const supervisor = Object.values(ctx.org.staff).find((s) => s.id === assignment.supervisorId);
    setClock(date, '16:00');
    const assigned = await tryCall(supervisor.email, 'post', `/issues/${created.id}/assign`, {
      body: { version: created.version, assigneeId: supervisor.id },
    });
    const started = assigned
      ? await tryCall(supervisor.email, 'post', `/issues/${created.id}/start`, {
          body: { version: assigned.version },
        })
      : null;
    if (started && spec.flow === 'resolved') {
      setClock(addDays(date, 1), '10:00');
      await tryCall(supervisor.email, 'post', `/issues/${created.id}/resolve`, {
        body: { version: started.version, resolutionNote: 'Réglé avec le gérant du magasin.' },
      });
    }
  }
}

async function announcements(ctx) {
  const director = emailOf(data.STAFF.director.email);
  for (const [index, spec] of data.ANNOUNCEMENTS.entries()) {
    if (
      await prisma.announcement.findFirst({ where: { agencyId: ctx.agency.id, title: spec.title } })
    )
      continue;
    const campaign = ctx.campaigns.find((c) => c.key === spec.campaign);
    setClock(addDays(today, -spec.age), index % 2 ? '09:05' : '17:40');
    await tryCall(director, 'post', '/announcements', {
      body: {
        title: spec.title,
        body: spec.body,
        targetRoles: spec.roles,
        ...(campaign ? { campaignId: campaign.row.id } : {}),
        ...(spec.wilaya ? { wilayaId: spec.wilaya } : {}),
      },
    });
  }
}

async function lostGift(ctx) {
  // Supervisors can request stock adjustments: one reports gifts lost between two stores.
  const requester = emailOf(data.STAFF.S2.email);
  const campaign = ctx.campaigns[0];
  const done = await prisma.stockMovement.count({
    where: { campaignId: campaign.row.id, type: 'adjustment' },
  });
  if (done) return;
  setClock(addDays(today, -2), '18:30');
  const lines = [{ stockItemId: campaign.gifts[0].id, quantity: 5 }];
  const sent = await tryCall(requester, 'post', `/campaigns/${campaign.row.id}/stock/adjustments`, {
    fields: {
      reason: 'lost',
      note: 'Cinq tasses perdues pendant le transport entre deux magasins.',
      lines: JSON.stringify(lines),
    },
    files: [['file', await photo('Lost gifts report', 'proof', 2)]],
  });
  if (sent?.id)
    await tryCall(
      emailOf(data.STAFF.director.email),
      'post',
      `/stock/adjustments/${sent.id}/approve`,
      {
        body: {},
      },
    );
}

/**
 * Issues and announcements are stamped with the database clock when created; give them the
 * simulated time they belong to, so "since 2 days" reads right next to the other history.
 */
async function polishDates(ctx) {
  for (const spec of data.ISSUES)
    await prisma.issue.updateMany({
      where: { agencyId: ctx.agency.id, title: spec.title },
      data: { createdAt: at(addDays(today, -spec.age), '14:10') },
    });
  const automatic = await prisma.issue.findMany({
    where: { agencyId: ctx.agency.id, title: 'Gift stock shortage' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const issue of automatic)
    await prisma.issue.update({
      where: { id: issue.id },
      data: { createdAt: at(addDays(today, -Math.floor(rand(issue.id) * 4)), '16:25') },
    });
  for (const spec of data.ANNOUNCEMENTS)
    await prisma.announcement.updateMany({
      where: { agencyId: ctx.agency.id, title: spec.title },
      data: { createdAt: at(addDays(today, -spec.age), '09:00') },
    });
}

async function clientPhotos(ctx) {
  for (const campaign of ctx.campaigns) {
    const photos = await prisma.visitPhoto.findMany({
      where: { visit: { campaignId: campaign.row.id } },
      orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }],
      take: 4,
    });
    for (const row of photos)
      await tryCall(
        emailOf(data.STAFF.director.email),
        'patch',
        `/files/${row.fileId}/visibility`,
        {
          body: { visibility: 'client_visible' },
        },
      );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function loadContext() {
  const agency = await prisma.agency.findUniqueOrThrow({ where: { code: AGENCY_CODE } });
  const org = await setupOrganization(agency); // idempotent, cheap
  const campaigns = [];
  for (const spec of data.CAMPAIGNS) {
    const row = await prisma.campaign.findFirstOrThrow({
      where: { agencyId: agency.id, name: spec.name },
    });
    const client = await prisma.client.findFirstOrThrow({
      where: { agencyId: agency.id, name: data.CLIENTS[spec.client].name },
    });
    const products = await prisma.product.findMany({
      where: { clientId: client.id },
      orderBy: { sku: 'asc' },
    });
    const items = await prisma.stockItem.findMany({
      where: { clientId: client.id },
      orderBy: { sku: 'asc' },
    });
    campaigns.push({
      ...spec,
      row,
      client,
      products,
      gifts: items.filter((i) => i.kind === 'gift'),
      sample: items.find((i) => i.kind === 'sample'),
    });
  }
  return { agency, org, campaigns };
}

if (REFRESH_TODAY) {
  const ctx = await loadContext();
  log(`Refreshing today (${today}, up to ${nowHHMM})…`);
  await runDay(ctx, today, nowHHMM);
  await announcements(ctx);
} else {
  const agency = await ensureAgency();
  log(`Agency ${agency.name} (${agency.code})`);
  const org = await setupOrganization(agency);
  log(
    `  ${data.ANIMATEURS.length} animateurs, ${data.STORES.length} stores, supervisors, managers`,
  );
  const campaigns = [];
  for (const spec of data.CAMPAIGNS) {
    campaigns.push(await setupCampaign(agency, org, spec));
    log(`  campaign ready: ${spec.name}`);
  }
  await setupFutureCampaigns(agency, org, campaigns);
  const ctx = { agency, org, campaigns };

  for (const campaign of campaigns) await distributeStock(campaign, org);
  await announcements(ctx);

  const first = Math.min(...data.CAMPAIGNS.map((c) => c.startOffset));
  for (let offset = first; offset <= 0; offset++) {
    const date = addDays(today, offset);
    log(`Day ${date} (${offset === 0 ? 'today' : -offset + ' days ago'})`);
    await runDay(ctx, date, offset === 0 ? nowHHMM : '23:59');
    await supervisorVisits(ctx, date, -offset);
    if (offset === -5) await absenceWithReplacement(ctx);
    if (offset === -2) await lostGift(ctx);
    if (offset === -1) await issues(ctx);
  }
  await clientPhotos(ctx);
  await polishDates(ctx);
}

clock.now = realNow;
log(`\nDone (${failures} call(s) refused — see the lines starting with "!" above).`);
log(`Sign in with any of these accounts, password = DEMO_PASSWORD:`);
for (const spec of [
  ...Object.values(data.STAFF).map((s) => [s.role, s.name, s.email]),
  ['client', data.CLIENTS.nedjma.portal.name, data.CLIENTS.nedjma.portal.email],
  ['client', data.CLIENTS.nour.portal.name, data.CLIENTS.nour.portal.email],
  ['animateur', data.ANIMATEURS[0][1], data.ANIMATEURS[0][0]],
])
  log(`  ${spec[0].padEnd(17)} ${emailOf(spec[2]).padEnd(40)} ${spec[1]}`);
await disconnectDatabase();
if (failures > 0) process.exitCode = 1;
