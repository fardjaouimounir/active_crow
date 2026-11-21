// Demo data generator for «ActiCrew Démo»: a believable, entirely fictional agency with a closed, an
// active and a planned campaign, built so that the dashboards and the AI have real patterns to find.
//
// Everything that touches a ledger (attendance, sales, gift entitlements, stock, the Tombola, issues,
// announcements, the campaign lifecycle, audit) goes through the real API in-process, as each user and
// with a controlled clock, so the numbers stay consistent. Master data (people, stores, brands, the
// roster of each campaign) is written directly. The script of what happens each day lives in
// showcasePlan.js; the texts in showcaseData.js.
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { buildUserActor } from '../../src/core/auth/actor.js';
import { hashPassword } from '../../src/core/auth/passwords.js';
import { signAccessToken } from '../../src/core/auth/tokens.js';
import { businessDate, clock } from '../../src/core/time/clock.js';
import { prisma } from '../../src/db/client.js';
import { withTransaction } from '../../src/db/transaction.js';
import { insertDraftCampaign } from '../../src/modules/campaigns/campaigns.repository.js';
import { lifecycleService } from '../../src/modules/campaigns/lifecycle.service.js';
import * as data from './showcaseData.js';
import * as plan from './showcasePlan.js';

const { addDays, daysBetween, minutesOf, pick, rand, toHHMM } = plan;

/** Thrown when the generator must not run (not demo mode, real data present, nothing to refresh). */
export class ShowcaseRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShowcaseRefusal';
  }
}

const emailOf = (key) => `${key}@${data.EMAIL_DOMAIN}`;
const scopeOf = (agency) => ({ level: 'agency', agencyId: agency.id });
/** Africa/Algiers is UTC+1 all year. */
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`);

// ─── Guard and reset ─────────────────────────────────────────────────────────

/** Anything in the database that is not demo data. Empty list = safe to wipe. */
export async function findNonDemoData(agencyCode = data.AGENCY.code) {
  const found = [];
  const count = async (label, promise) => {
    const n = await promise;
    if (n > 0) found.push(`${n} ${label}`);
  };
  await Promise.all([
    count('user(s) not flagged is_demo', prisma.user.count({ where: { isDemo: false } })),
    count('store(s) not flagged is_demo', prisma.pointOfSale.count({ where: { isDemo: false } })),
    count('region(s) not flagged is_demo', prisma.region.count({ where: { isDemo: false } })),
    count(
      'campaign(s) of another agency',
      prisma.campaign.count({ where: { agency: { code: { not: agencyCode } } } }),
    ),
    count(
      'client(s) of another agency',
      prisma.client.count({ where: { agency: { code: { not: agencyCode } } } }),
    ),
  ]);
  return found;
}

export function assertDemoMode(env = process.env) {
  if (env.DEMO_MODE !== 'true')
    throw new ShowcaseRefusal(
      'The showcase generator runs only with DEMO_MODE=true (set it in apps/api/.env or inline).',
    );
  if (env.NODE_ENV === 'production')
    throw new ShowcaseRefusal('The showcase generator is disabled in production.');
}

async function assertOnlyDemoData(agencyCode) {
  const found = await findNonDemoData(agencyCode);
  if (found.length)
    throw new ShowcaseRefusal(
      `Refusing to run: the database holds non-demo data (${found.join(', ')}).`,
    );
}

/**
 * Empties every business table (the demo agency is rebuilt from scratch). Ledger tables are
 * append-only, so the only way to reset them is TRUNCATE, which is why the guard above matters.
 * Reference data (wilayas, communes), the agencies and the migration history stay.
 */
async function resetDatabase() {
  await prisma.$executeRaw`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ') INTO tables
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('wilayas', 'communes', '_prisma_migrations', 'agencies');
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$`;
}

// ─── The run ─────────────────────────────────────────────────────────────────

/**
 * @param {{ refreshToday?: boolean, compact?: boolean, now?: string, log?: (line: string) => void,
 *   password?: string }} [options] `compact` simulates only the last days of each campaign (tests).
 * @returns {Promise<object>} the context (agency, people, campaigns, failures) for the report
 */
export async function runShowcase(options = {}) {
  const { refreshToday = false, compact = false } = options;
  const log = options.log ?? (() => {});
  const password = options.password ?? process.env.DEMO_PASSWORD?.trim();
  assertDemoMode();
  if (!password) throw new ShowcaseRefusal('Set DEMO_PASSWORD in apps/api/.env');
  const agencyCode = process.env.SHOWCASE_AGENCY ?? data.AGENCY.code;
  if (!/^ACTICREW[A-Z0-9-]*$/.test(agencyCode))
    throw new ShowcaseRefusal('SHOWCASE_AGENCY must start with ACTICREW');
  await assertOnlyDemoData(agencyCode);

  const realNow = clock.now;
  const today = businessDate(realNow());
  const nowHHMM =
    options.now ??
    process.env.SHOWCASE_NOW ??
    new Date(+realNow() + 3_600_000).toISOString().slice(11, 16);

  const app = createApp();
  app.set('trust proxy', true); // each simulated user gets an own address (rate limit)
  const engine = createEngine({ app, today, log, compact });
  try {
    if (refreshToday) {
      const ctx = await engine.loadContext(agencyCode);
      log(`Refreshing today (${today}, up to ${nowHHMM})…`);
      await engine.refreshToday(ctx, nowHHMM);
      return finish(engine, ctx, realNow);
    }
    log('Resetting the demo database…');
    await resetDatabase();
    const ctx = await engine.buildAll({ agencyCode, password, nowHHMM });
    return finish(engine, ctx, realNow);
  } finally {
    clock.now = realNow;
  }
}

function finish(engine, ctx, realNow) {
  clock.now = realNow;
  return { ...ctx, failures: engine.failures };
}

// ─── Engine ──────────────────────────────────────────────────────────────────

function createEngine({ app, today, log, compact }) {
  const realNow = clock.now;
  const failures = [];
  const seen = new Set();
  const accounts = new Map();

  // ─ Time
  const setClock = (date, hhmm) => {
    const instant = at(date, hhmm);
    clock.now = () => new Date(instant);
  };

  // ─ HTTP as a given user. Access tokens are minted at the simulated time, so the seed never hits the
  // login rate limit however far the clock jumps.
  const addressOf = (email) => {
    const digest = createHash('sha1').update(email).digest();
    return `10.${digest[0]}.${digest[1]}.${digest[2]}`;
  };
  async function tokenFor(email) {
    if (!accounts.has(email)) {
      accounts.set(
        email,
        await prisma.user.findUniqueOrThrow({
          where: { email },
          select: {
            id: true,
            agencyId: true,
            role: true,
            clientId: true,
            tokenVersion: true,
            mustChangePassword: true,
          },
        }),
      );
    }
    return (await signAccessToken(accounts.get(email))).accessToken;
  }
  async function call(email, method, path, { body, fields, files } = {}) {
    const token = await tokenFor(email);
    const req = request(app)
      [method]('/api/v1' + path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', addressOf(email));
    if (method === 'post') req.set('Idempotency-Key', randomUUID());
    let res;
    if (fields || files) {
      for (const [name, value] of Object.entries(fields ?? {})) req.field(name, value);
      for (const [name, buffer, filename] of files ?? [])
        req.attach(name, buffer, filename ?? 'photo.jpg');
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
      error.body = res.body;
      throw error;
    }
    return res.body.data ?? res.body;
  }
  async function tryCall(...args) {
    try {
      return await call(...args);
    } catch (error) {
      if (!seen.has(error.message)) {
        seen.add(error.message);
        failures.push(error.message);
        log(`  ! ${error.message}`);
      }
      return null;
    }
  }
  /** Like tryCall but a refusal is a bug in the script: stop. */
  const mustCall = (...args) => call(...args);

  // ─ Photos: generated placeholders showing the store name (Latin text; no people)
  const PALETTES = [
    ['#1f3b4d', '#2f6f8f'],
    ['#3d2b1f', '#8f5a2f'],
    ['#1f3d2b', '#3d8f4f'],
    ['#2e1f3d', '#7a3d8f'],
    ['#3d1f26', '#8f3d4a'],
    ['#1f2a3d', '#4a5a8f'],
  ];
  const photoCache = new Map();
  async function photo(label, sublabel, index = 0) {
    const key = `${label}|${sublabel}|${index % PALETTES.length}`;
    if (photoCache.has(key)) return photoCache.get(key);
    const [from, to] = PALETTES[index % PALETTES.length];
    const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = Buffer.from(
      `<svg width="640" height="420" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><rect x="40" y="250" width="560" height="110" rx="10" fill="#ffffff22"/><rect x="170" y="90" width="300" height="110" rx="12" fill="#ffffff2e"/><text x="320" y="296" font-size="26" fill="white" text-anchor="middle" font-family="sans-serif">${esc(label)}</text><text x="320" y="336" font-size="20" fill="#ffffffcc" text-anchor="middle" font-family="sans-serif">${esc(sublabel)}</text></svg>`,
    );
    const buffer = await sharp(svg).jpeg({ quality: 78 }).toBuffer();
    if (photoCache.size > 400) photoCache.clear();
    photoCache.set(key, buffer);
    return buffer;
  }
  /** A small valid one-page PDF: the final report of a campaign (ASCII text only). */
  function reportPdf(lines) {
    const esc = (text) => text.replace(/[\\()]/g, '\\$&');
    const content = [
      'BT',
      '/F1 12 Tf',
      '50 780 Td',
      '16 TL',
      ...lines.map((l) => `(${esc(l)}) Tj T*`),
      'ET',
    ].join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
  }

  // ─── Master data ───────────────────────────────────────────────────────────

  let passwordHash;
  async function ensureAgency(agencyCode) {
    return prisma.agency.upsert({
      where: { code: agencyCode },
      update: { name: data.AGENCY.name },
      create: { code: agencyCode, name: data.AGENCY.name },
    });
  }
  async function ensureUser(agency, spec) {
    const email = emailOf(spec.emailKey);
    const common = {
      fullName: spec.name,
      role: spec.role,
      wilayaId: spec.wilayaId ?? null,
      clientId: spec.clientId ?? null,
      phone: `055501${String(Math.floor(rand(email) * 10_000)).padStart(4, '0')}`,
      passwordHash,
      mustChangePassword: false,
      status: 'active',
      isDemo: true,
    };
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return prisma.user.update({ where: { id: existing.id }, data: common });
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
    const history = new Date(addDays(today, -90));
    const staff = {};
    for (const [key, spec] of Object.entries(data.STAFF))
      staff[key] = await ensureUser(agency, { ...spec, emailKey: spec.email });
    await ensureReportingLine(agency, staff.general, staff.director, history);
    for (const key of ['centre', 'ouest'])
      await ensureReportingLine(agency, staff[key], staff.general, history);
    for (const key of ['S1', 'S2', 'S3', 'S4']) {
      const wilayaId = data.STAFF[key].wilayaId;
      await ensureReportingLine(agency, staff[key], staff[plan.regionalKeyOf(wilayaId)], history);
    }
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
    for (const [emailKey, name, wilayaId] of data.ANIMATEURS) {
      const user = await ensureUser(agency, { emailKey, name, role: 'animateur', wilayaId });
      await ensureReportingLine(agency, user, staff[plan.supervisorKeyOf(wilayaId)], history);
      animateurs[emailKey] = user;
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
          contactName: `${pick(data.FIRST_NAMES, code)} ${pick(data.FAMILY_NAMES, code + 'f')}`,
          contactPhone: `055502${String(Math.floor(rand(code) * 10_000)).padStart(4, '0')}`,
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
    for (const [sku, name, unitLabel, referencePrice] of spec.products)
      await prisma.product.upsert({
        where: { clientId_sku: { clientId: client.id, sku } },
        update: { name, unitLabel, referencePrice },
        create: { agencyId: agency.id, clientId: client.id, sku, name, unitLabel, referencePrice },
      });
    for (const [kind, sku, name, unitLabel] of spec.stock)
      await prisma.stockItem.upsert({
        where: { clientId_sku: { clientId: client.id, sku } },
        update: { name, unitLabel },
        create: { agencyId: agency.id, clientId: client.id, kind, sku, name, unitLabel },
      });
    const portalUser = await ensureUser(agency, {
      emailKey: spec.portal.email,
      name: spec.portal.name,
      role: 'client',
      clientId: client.id,
    });
    return { client, portalUser };
  }

  /** Products and stock items in the order of the demo data: product slots 0 and 1 earn gift 0 and 1. */
  async function catalogOf(client, key) {
    const spec = data.CLIENTS[key];
    const products = await prisma.product.findMany({ where: { clientId: client.id } });
    const items = await prisma.stockItem.findMany({ where: { clientId: client.id } });
    const inOrder = (rows, skus) => skus.map((sku) => rows.find((row) => row.sku === sku));
    return {
      products: inOrder(
        products,
        spec.products.map(([sku]) => sku),
      ),
      gifts: inOrder(
        items,
        spec.stock.filter(([kind]) => kind === 'gift').map(([, sku]) => sku),
      ),
      sample: items.find((item) => item.kind === 'sample'),
    };
  }

  // ─── Campaigns ─────────────────────────────────────────────────────────────

  /** The campaign as the planner sees it (offsets from the run day). */
  const planSpec = (spec) => ({
    ...spec,
    startOffset: spec.startOffset,
    endOffset: spec.endOffset,
  });
  const datesOf = (spec) => plan.datesOf(today, spec);
  /** First simulated day of a campaign (all of it, or its last days in compact mode). */
  function simFrom(spec) {
    const { start, end } = datesOf(spec);
    if (!compact) return start;
    const from = spec.status === 'closed' ? addDays(end, -2) : addDays(today, -5);
    return from > start ? from : start;
  }

  async function setupCampaign(ctx, spec) {
    const { agency, org } = ctx;
    const { start, end } = datesOf(spec);
    const catalog = ctx.clients[spec.client];
    const director = org.staff.director;
    const D = director.email;
    const base = (campaign) => ({ agencyId: agency.id, campaignId: campaign.id });
    setClock(addDays(start, -10), '09:00');
    const draft = await withTransaction((tx) =>
      insertDraftCampaign(
        tx,
        scopeOf(agency),
        {
          clientId: catalog.client.id,
          name: spec.name,
          description: spec.description,
          startDate: start,
          endDate: end,
          budgetAmount: spec.budget,
        },
        director.id,
      ),
    );
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: draft.id } });
    const b = base(campaign);

    // Roster: the Animateurs of the campaign grouped by wilaya (all members of the team of their
    // supervisor), or the wilaya needs of the planned campaign.
    const members = data.ANIMATEURS.filter(([key]) => plan.assignmentWindow(today, spec, key));
    const perWilaya = new Map();
    if (spec.status === 'planning')
      for (const [w, n] of Object.entries(data.PLANNED_WILAYAS)) perWilaya.set(Number(w), n);
    else
      for (const [, , wilayaId] of members)
        perWilaya.set(wilayaId, (perWilaya.get(wilayaId) ?? 0) + 1);
    const wilayaIds = [...perWilaya.keys()];
    await prisma.campaignWilaya.createMany({
      data: wilayaIds.map((wilayaId) => ({
        ...b,
        wilayaId,
        requiredAnimateurs: perWilaya.get(wilayaId),
      })),
    });
    await prisma.campaignStaff.createMany({
      data: wilayaIds.flatMap((wilayaId) => {
        const [region, supervisor] = data.WILAYA_PLAN[wilayaId];
        return [
          { ...b, wilayaId, role: 'regional_manager', userId: org.staff[region].id },
          {
            ...b,
            wilayaId,
            role: 'supervisor',
            userId: org.staff[supervisor].id,
            requiredAnimateurs: perWilaya.get(wilayaId),
          },
        ];
      }),
    });
    const storeCodes = new Set([
      ...members.map(([, , , store]) => store),
      ...(data.EXTRA_STORES[spec.key] ?? []),
    ]);
    await prisma.campaignPointOfSale.createMany({
      data: [...storeCodes].map((code) => ({ ...b, pointOfSaleId: org.stores[code].id })),
    });
    await prisma.campaignProduct.createMany({
      data: catalog.products.map((product) => ({ ...b, productId: product.id })),
    });

    // Rules, tiered promotion and approval: through the rule-set endpoints.
    const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const rules = `/campaigns/${campaign.id}/rule-sets/${ruleSet.id}`;
    const putRule = (type, config) =>
      mustCall(D, 'put', `${rules}/rules/${type}`, { body: config });
    await putRule('attendance', {
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
    });
    await putRule('customer_fields', {
      fullName: 'optional',
      phone: 'optional',
      consentRequired: false,
    });
    await putRule('sales_target', {
      dailyUnitsPerAnimateur: spec.targets.dailyUnitsPerAnimateur,
      perProduct: [],
    });
    await putRule('sampling_target', {
      dailySamplesPerAnimateur: spec.targets.dailySamplesPerAnimateur,
      stockItemId: catalog.sample.id,
    });
    await mustCall(D, 'put', `${rules}/promotions`, {
      body: {
        promotions: [0, 1].map((slot) => ({
          type: 'tiered_gift',
          name: `${catalog.products[slot].name} + ${catalog.gifts[slot].name}`,
          maxPerCustomer: null,
          productId: catalog.products[slot].id,
          tiers: [
            { minQuantity: 1, stockItemId: catalog.gifts[slot].id, giftQuantity: 1 },
            { minQuantity: 3, stockItemId: catalog.gifts[slot].id, giftQuantity: 2 },
          ],
        })),
      },
    });
    await mustCall(D, 'post', `${rules}/approve`, { body: {} });

    // Team and approved assignments (the supervisor proposed, the regional manager approved).
    const supervisorOf = (wilayaId) => org.staff[plan.supervisorKeyOf(wilayaId)];
    const regionalOf = (wilayaId) => org.staff[plan.regionalKeyOf(wilayaId)];
    for (const [key, , wilayaId, storeCode] of members) {
      const supervisor = supervisorOf(wilayaId);
      const animateur = org.animateurs[key];
      await prisma.campaignAnimateur.create({
        data: {
          ...b,
          supervisorId: supervisor.id,
          animateurId: animateur.id,
          addedById: supervisor.id,
        },
      });
      const window = plan.assignmentWindow(today, spec, key);
      // The replacement is on the team but joins the field through the replace endpoint.
      if (spec.key === 'najma' && key === data.REPLACEMENT.replacement) continue;
      await prisma.assignment.create({
        data: {
          ...b,
          animateurId: animateur.id,
          supervisorId: supervisor.id,
          pointOfSaleId: org.stores[storeCode].id,
          proposedById: supervisor.id,
          startDate: new Date(window.from),
          // The replaced Animateur's assignment runs to the end until the replacement shortens it.
          endDate: new Date(
            spec.key === 'najma' && key === data.REPLACEMENT.replaced ? end : window.to,
          ),
          workDays: [1, 2, 3, 4, 5, 6, 7],
          status: 'approved',
          decidedById: regionalOf(wilayaId).id,
          decidedAt: at(addDays(start, -3), '10:00'),
        },
      });
    }

    // Tombola (open until the end of the campaign) while the campaign can still be configured.
    let tombola = null;

    // Lifecycle: plan → assigned → active, each step at its own simulated time.
    setClock(addDays(start, -6), '10:00');
    await lifecycleService.transition(
      scopeOf(agency),
      buildUserActor(director),
      campaign.id,
      'plan',
    );
    if (spec.status !== 'planning') {
      setClock(addDays(start, -3), '10:00');
      await lifecycleService.transition(
        scopeOf(agency),
        buildUserActor(director),
        campaign.id,
        'mark-assigned',
      );
      if (spec.tombola) {
        setClock(addDays(start, -2), '10:00');
        tombola = await mustCall(D, 'post', `/campaigns/${campaign.id}/tombolas`, {
          body: {
            name: spec.tombola.name,
            entryBasis: 'per_sale',
            entriesPerBasis: 1,
            maxEntriesPerCustomer: null,
            requiresPurchase: true,
            registrationEndsAt: at(end, '23:59').toISOString(),
            drawScheduledAt: at(addDays(end, 2), '18:00').toISOString(),
            winnersCount: spec.tombola.winners,
            reservesCount: spec.tombola.reserves,
          },
        });
      }
      setClock(start, '00:00');
      await lifecycleService.transition(
        scopeOf(agency),
        buildUserActor(director),
        campaign.id,
        'activate',
      );
    } else {
      // Planned campaign: a few proposals still waiting for the regional manager's decision.
      const proposals = [
        ['amina.benali', 'PDV-ALG-02'],
        ['sara.boukrou', 'PDV-ALG-03'],
        ['hamza.belhadj', 'PDV-ORA-02'],
        ['nabil.guerfi', 'PDV-ORA-03'],
        ['adel.rahmani', 'PDV-CON-02'],
      ];
      for (const [key, storeCode] of proposals) {
        const wilayaId = data.ANIMATEURS.find(([k]) => k === key)[2];
        const supervisor = supervisorOf(wilayaId);
        await prisma.campaignAnimateur.create({
          data: {
            ...b,
            supervisorId: supervisor.id,
            animateurId: org.animateurs[key].id,
            addedById: supervisor.id,
          },
        });
        await prisma.campaignPointOfSale.upsert({
          where: {
            campaignId_pointOfSaleId: {
              campaignId: campaign.id,
              pointOfSaleId: org.stores[storeCode].id,
            },
          },
          update: {},
          create: { ...b, pointOfSaleId: org.stores[storeCode].id },
        });
        await prisma.assignment.create({
          data: {
            ...b,
            animateurId: org.animateurs[key].id,
            supervisorId: supervisor.id,
            pointOfSaleId: org.stores[storeCode].id,
            proposedById: supervisor.id,
            // They are all on the active campaign until it ends: the proposal starts right after.
            startDate: new Date(
              addDays(datesOf(data.CAMPAIGNS.find((c) => c.key === 'najma')).end, 1),
            ),
            endDate: new Date(end),
            workDays: [1, 2, 3, 4, 5, 6, 7],
            status: 'proposed',
          },
        });
      }
    }
    clock.now = realNow;
    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    return {
      ...spec,
      row,
      ...catalog,
      client: spec.client,
      tombolaId: tombola?.id ?? null,
      members,
    };
  }

  // ─── Stock: client → warehouse → regional → supervisor → Animateur ─────────

  const giftLines = (campaign, [a, b]) => [
    { stockItemId: campaign.gifts[0].id, quantity: a },
    { stockItemId: campaign.gifts[1].id, quantity: b },
  ];
  const positive = (lines) => lines.filter((line) => line.quantity > 0);

  /** One transfer, confirmed by the recipient (optionally receiving less: a dispute). */
  async function move(campaign, from, to, lines, received) {
    const sent = positive(lines);
    if (!sent.length) return null;
    const out = await tryCall(from.email, 'post', `/campaigns/${campaign.row.id}/stock/transfers`, {
      body: { recipientUserId: to.id, lines: sent },
    });
    if (!out) return null;
    await tryCall(to.email, 'post', `/stock/transfers/${out.id}/confirm`, {
      body: {
        lines: sent.map((line) => ({
          stockItemId: line.stockItemId,
          quantityReceived: received?.[line.stockItemId] ?? line.quantity,
        })),
      },
    });
    return out;
  }

  /** How many gifts an Animateur should receive: his planned need plus a margin, or exactly the
   * planned need up to 4 days ago (so it runs dry 3 days ago) for the team whose delivery ran short (the shortage story). */
  function supplyFor(ctx, campaign, key) {
    const { end } = datesOf(campaign);
    const from = simFrom(campaign);
    const window = plan.assignmentWindow(today, campaign, key);
    const to = window.to < end ? window.to : end;
    const short =
      campaign.status === 'active' && plan.supervisorKeyOf(plan.SPECS.get(key).wilayaId) === 'S1';
    const need = plan.giftNeed({
      today,
      campaign: planSpec(campaign),
      key,
      from: from > window.from ? from : window.from,
      to: short && addDays(today, -4) < to ? addDays(today, -4) : to,
    });
    return short ? need : need.map((n) => Math.ceil(n * 1.12) + 6);
  }

  async function distributeStock(ctx, campaign) {
    const { org } = ctx;
    const D = org.staff.director.email;
    const { start } = datesOf(campaign);
    const roster = campaign.members.map(([key]) => key);
    const perAnimateur = new Map(roster.map((key) => [key, supplyFor(ctx, campaign, key)]));
    const sum = (rows, extra = 0) =>
      rows.reduce((acc, row) => acc.map((n, i) => n + row[i]), [extra, extra]);
    const supervisors = new Map();
    for (const key of roster) {
      const supervisor = plan.supervisorKeyOf(plan.SPECS.get(key).wilayaId);
      supervisors.set(supervisor, [...(supervisors.get(supervisor) ?? []), perAnimateur.get(key)]);
    }
    const supervisorTotals = new Map(
      [...supervisors].map(([supervisor, rows]) => [supervisor, sum(rows, 30)]),
    );
    const regionals = new Map();
    for (const [supervisor, total] of supervisorTotals) {
      const region = plan.regionalKeyOf(data.STAFF[supervisor].wilayaId);
      regionals.set(region, [...(regionals.get(region) ?? []), total]);
    }
    const regionalTotals = new Map([...regionals].map(([region, rows]) => [region, sum(rows, 60)]));
    const dispute = campaign.status === 'active' ? 'hamza.belhadj' : null;
    const warehouse = sum([...regionalTotals.values()], 120);

    setClock(start, '08:10');
    await mustCall(D, 'post', `/campaigns/${campaign.row.id}/stock/stock-in`, {
      body: {
        reference: `BL-${campaign.key.toUpperCase()}-001`,
        lines: [
          ...giftLines(
            campaign,
            warehouse.map((n) => n + (dispute ? 100 : 0)),
          ),
          { stockItemId: campaign.sample.id, quantity: 6000 },
        ],
      },
    });
    setClock(start, '09:00');
    for (const [region, total] of regionalTotals)
      await move(
        campaign,
        org.staff.director,
        org.staff[region],
        giftLines(
          campaign,
          total.map((n) => n + (dispute && region === 'ouest' ? 100 : 0)),
        ),
      );
    setClock(start, '09:30');
    for (const [supervisor, total] of supervisorTotals) {
      const region = plan.regionalKeyOf(data.STAFF[supervisor].wilayaId);
      const extra = dispute && supervisor === 'S3' ? 100 : 0;
      await move(
        campaign,
        org.staff[region],
        org.staff[supervisor],
        giftLines(campaign, [total[0] + extra, total[1]]),
      );
    }
    setClock(start, '10:00');
    for (const key of roster) {
      const supervisorKey = plan.supervisorKeyOf(plan.SPECS.get(key).wilayaId);
      const window = plan.assignmentWindow(today, campaign, key);
      if (window.from > start) continue; // joins later: stocked when he does
      const lines = giftLines(campaign, perAnimateur.get(key));
      if (key === dispute) {
        // 100 gifts leave the supervisor, 95 arrive: the recipient disputes, the manager writes 5 off.
        const sent = await tryCall(
          org.staff[supervisorKey].email,
          'post',
          `/campaigns/${campaign.row.id}/stock/transfers`,
          {
            body: {
              recipientUserId: org.animateurs[key].id,
              lines: [{ stockItemId: campaign.gifts[0].id, quantity: 100 }],
            },
          },
        );
        if (sent) {
          await tryCall(emailOf(key), 'post', `/stock/transfers/${sent.id}/confirm`, {
            body: { lines: [{ stockItemId: campaign.gifts[0].id, quantityReceived: 95 }] },
          });
          setClock(addDays(start, 1), '09:00');
          const resolved = await tryCall(
            org.staff.ouest.email,
            'post',
            `/stock/transfers/${sent.id}/resolve`,
            {
              body: {
                lines: [{ stockItemId: campaign.gifts[0].id, decision: 'loss' }],
                note: 'خمس هدايا لم تصل مع الشاحنة، تم تسجيلها كخسارة بعد التحقق من وصل التسليم.',
              },
            },
          );
          if (!resolved)
            await tryCall(D, 'post', `/stock/transfers/${sent.id}/resolve`, {
              body: {
                lines: [{ stockItemId: campaign.gifts[0].id, decision: 'loss' }],
                note: 'خمس هدايا لم تصل مع الشاحنة، تم تسجيلها كخسارة بعد التحقق من وصل التسليم.',
              },
            });
          setClock(start, '10:00');
        }
      }
      await move(campaign, org.staff[supervisorKey], org.animateurs[key], lines);
    }
    log(`  stock moved down the chain for "${campaign.name}"`);
  }

  // ─── Daily field activity ──────────────────────────────────────────────────

  let ctxRef = null;

  /**
   * One working day for every active assignment, up to `limit` (HH:MM). Every action is skipped if it
   * already exists, so the same call can top up today again and again (idempotent per hour).
   */
  async function runDay(ctx, date, limit) {
    const age = daysBetween(date, today);
    const day = new Date(date);
    const assignments = await prisma.assignment.findMany({
      where: {
        agencyId: ctx.agency.id,
        status: 'approved',
        startDate: { lte: day },
        endDate: { gte: day },
      },
      orderBy: { id: 'asc' },
    });
    if (!assignments.length) return;
    const byId = (list) => new Map(list.map((row) => [row.id, row]));
    const campaigns = byId(ctx.campaigns.map((c) => ({ ...c, id: c.row.id })));
    const keyOf = new Map(Object.entries(ctx.org.animateurs).map(([key, user]) => [user.id, key]));
    const stores = byId(Object.values(ctx.org.stores));
    const staff = byId(Object.values(ctx.org.staff));
    const [records, absences, sales, interactions] = await Promise.all([
      prisma.attendanceRecord.findMany({ where: { workDate: day, agencyId: ctx.agency.id } }),
      prisma.absence.findMany({
        where: { workDate: day, agencyId: ctx.agency.id, voidedAt: null },
      }),
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
      const key = keyOf.get(assignment.animateurId);
      const campaign = campaigns.get(assignment.campaignId);
      if (!key || !campaign || campaign.status === 'planning') continue;
      if (date < simFrom(campaign)) continue;
      const planned = plan.planDay({ today, campaign: planSpec(campaign), key, date });
      if (!planned) continue;
      const email = emailOf(key);
      const store = stores.get(assignment.pointOfSaleId);
      const supervisorEmail = staff.get(assignment.supervisorId).email;
      const id = assignment.id;
      const seed = `${key}${date}`;
      const hasRecord = (checkpoint) =>
        records.some((r) => r.assignmentId === id && r.checkpoint === checkpoint);
      const recorded = absences.some((a) => a.assignmentId === id);

      // Absence (recorded by the supervisor at 10:30) …
      if (planned.absence) {
        if (!recorded && due('10:30')) {
          setClock(date, '10:30');
          const justified = planned.absence === 'justified';
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

      // … or the morning check-in (GPS + photo); some of today's are not sent yet.
      const notSent = age === 0 && rand(seed + 'ns') < 0.08;
      if (!hasRecord('morning') && !notSent && due(planned.checkin)) {
        setClock(date, planned.checkin);
        const spread = planned.far ? 0.012 : 0.0004;
        const near = (axis) =>
          (Number(store[axis]) + (rand(seed + axis) - 0.5) * spread * 2).toFixed(6);
        await tryCall(email, 'post', `/assignments/${id}/attendance`, {
          fields: {
            checkpoint: 'morning',
            latitude: near('latitude'),
            longitude: near('longitude'),
            gpsAccuracyM: String(planned.accuracy),
          },
          files: [
            [
              'photo',
              await photo(store.name, `${date} ${planned.checkin}`, minutesOf(planned.checkin)),
            ],
          ],
        });
      }
      if (notSent) continue;

      // Sales through the day, gifts handed over on the spot.
      const done = salesDone.get(assignment.animateurId) ?? 0;
      for (let index = done; index < planned.sales.length; index++) {
        const sale = planned.sales[index];
        if (sale.minute > limitMinutes) break;
        setClock(date, toHHMM(sale.minute));
        await tryCall(email, 'post', `/assignments/${id}/sales`, {
          body: {
            items: [
              { productId: campaign.products[sale.productIndex].id, quantity: sale.quantity },
            ],
            ...(sale.customer
              ? {
                  customer: {
                    fullName: sale.customer.fullName,
                    phone: sale.customer.phone,
                    consentTombola: sale.customer.consent,
                  },
                }
              : {}),
          },
        });
      }
      if (!interactionsDone.has(assignment.animateurId) && due('12:20')) {
        setClock(date, '12:20');
        await tryCall(email, 'post', `/assignments/${id}/interactions`, {
          body: { kind: 'sample', count: planned.samples },
        });
      }

      // Closing check-in (photo) once the shift ends.
      if (planned.closing && !hasRecord('closing') && due(planned.closing)) {
        setClock(date, planned.closing);
        await tryCall(email, 'post', `/assignments/${id}/attendance`, {
          fields: { checkpoint: 'closing' },
          files: [
            [
              'photo',
              await photo(
                store.name,
                `closing ${date} ${planned.closing}`,
                minutesOf(planned.closing) + 2,
              ),
            ],
          ],
        });
      }
    }
    await reviewDay(ctx, date, age, due);
  }

  /** The review queue: the director verifies the day in the evening, keeps the last two days partly
   * pending, and rejects a few proofs. */
  const REJECTIONS = [
    ['soraya.merah', 4],
    ['amar.sebti', 7],
    ['anis.cherfaoui', 11],
    ['meriem.hamdi', 15],
  ];
  const PENDING_SHARE = { 1: 0.35, 2: 0.1 };
  async function reviewDay(ctx, date, age, due) {
    if (age < 1 || !due('19:30')) return;
    const day = new Date(date);
    const pending = await prisma.attendanceRecord.findMany({
      where: { agencyId: ctx.agency.id, workDate: day, status: 'pending' },
      orderBy: { id: 'asc' },
    });
    if (!pending.length) return;
    setClock(date, '19:45');
    const director = ctx.org.staff.director.email;
    const keyOf = new Map(Object.entries(ctx.org.animateurs).map(([key, user]) => [user.id, key]));
    const rejected = [];
    for (const [key, ago] of REJECTIONS) {
      const row =
        ago === age &&
        pending.find((r) => keyOf.get(r.animateurId) === key && r.checkpoint === 'morning');
      if (!row) continue;
      rejected.push(row.id);
      await tryCall(director, 'post', `/attendance/${row.id}/reject`, {
        body: { reason: pick(data.REJECTION_REASONS, key + date) },
      });
    }
    const share = PENDING_SHARE[age] ?? 0;
    const verify = pending.filter(
      (row) =>
        !rejected.includes(row.id) &&
        rand(`${keyOf.get(row.animateurId)}${date}${row.checkpoint}rv`) >= share,
    );
    for (const [campaignId, rows] of Map.groupBy(verify, (row) => row.campaignId))
      await tryCall(director, 'post', `/campaigns/${campaignId}/attendance/verify-bulk`, {
        body: { ids: rows.map((row) => row.id) },
      });
  }

  // ─── One-off stories, each guarded so reruns never duplicate ───────────────

  /** Supervisors visit stores every other day. Constantine is left 40% unvisited (coverage story). */
  const UNVISITED = new Set(['PDV-CON-04', 'PDV-CON-05']);
  async function supervisorVisits(ctx, date) {
    const day = new Date(date);
    for (const campaign of ctx.campaigns) {
      if (campaign.status === 'planning') continue;
      const { start, end } = datesOf(campaign);
      if (date < simFrom(campaign) || date > end) continue;
      const index = daysBetween(start, date);
      if (index % 2 !== 0) continue;
      if (
        await prisma.supervisorVisit.count({
          where: {
            campaignId: campaign.row.id,
            visitedAt: { gte: at(date, '00:00'), lt: at(addDays(date, 1), '00:00') },
          },
        })
      )
        continue;
      for (const key of ['S1', 'S2', 'S3', 'S4']) {
        const supervisor = ctx.org.staff[key];
        const team = await prisma.assignment.findMany({
          where: {
            campaignId: campaign.row.id,
            supervisorId: supervisor.id,
            status: 'approved',
            startDate: { lte: day },
            endDate: { gte: day },
          },
          include: { pointOfSale: { select: { code: true } } },
          orderBy: { pointOfSale: { code: 'asc' } },
        });
        const visitable = team.filter((a) => !UNVISITED.has(a.pointOfSale.code));
        if (!visitable.length) continue;
        const target = visitable[((index / 2) % visitable.length) | 0];
        const store = ctx.org.stores[target.pointOfSale.code];
        setClock(date, '11:20');
        await tryCall(supervisor.email, 'post', `/campaigns/${campaign.row.id}/visits`, {
          fields: {
            pointOfSaleId: target.pointOfSaleId,
            observedAnimateurIds: JSON.stringify([target.animateurId]),
            notes: pick(data.VISIT_NOTES, key + date),
            latitude: Number(store.latitude).toFixed(6),
            longitude: Number(store.longitude).toFixed(6),
          },
          files: [
            ['photos', await photo(store.name, `visite ${date}`, index)],
            ['photos', await photo(store.name, `rayon ${date}`, index + 3)],
          ],
        });
      }
    }
  }

  async function issuesOn(ctx, date) {
    const age = daysBetween(date, today);
    for (const spec of data.ISSUES.filter((issue) => issue.age === age)) {
      if (await prisma.issue.findFirst({ where: { agencyId: ctx.agency.id, title: spec.title } }))
        continue;
      const campaign = ctx.campaigns.find((c) => c.key === spec.campaign);
      const reporter = ctx.org.animateurs[spec.by];
      const assignment = await prisma.assignment.findFirst({
        where: { animateurId: reporter.id, campaignId: campaign.row.id, status: 'approved' },
      });
      if (!assignment) continue;
      setClock(date, '14:10');
      const created = await tryCall(emailOf(spec.by), 'post', '/issues', {
        body: {
          campaignId: campaign.row.id,
          pointOfSaleId: assignment.pointOfSaleId,
          category: spec.category,
          title: spec.title,
          description: spec.description,
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
        setClock(addDays(date, 1) > today ? date : addDays(date, 1), '10:00');
        await tryCall(supervisor.email, 'post', `/issues/${created.id}/resolve`, {
          body: { version: started.version, resolutionNote: 'Réglé avec le gérant du magasin.' },
        });
      }
    }
  }

  async function announcementsOn(ctx, date) {
    const age = daysBetween(date, today);
    for (const [index, spec] of data.ANNOUNCEMENTS.entries()) {
      if (spec.age !== age) continue;
      if (
        await prisma.announcement.findFirst({
          where: { agencyId: ctx.agency.id, title: spec.title },
        })
      )
        continue;
      const campaign = ctx.campaigns.find((c) => c.key === spec.campaign);
      setClock(date, index % 2 ? '09:05' : '17:40');
      await tryCall(ctx.org.staff.director.email, 'post', '/announcements', {
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

  /** The leave: the supervisor replaces the absent Animateur from the next day on. */
  async function replacementOn(ctx, date) {
    const { replaced, replacement, leaveOffset } = data.REPLACEMENT;
    const campaign = ctx.campaigns.find((c) => c.key === 'najma');
    if (date === addDays(today, leaveOffset + 1) && date >= simFrom(campaign)) {
      // The next day the replacement is on the field: the supervisor equips her.
      setClock(date, '09:00');
      const lines = giftLines(campaign, supplyFor(ctx, campaign, replacement));
      if (
        !(await prisma.stockMovement.count({
          where: {
            campaignId: campaign.row.id,
            toLocation: { userId: ctx.org.animateurs[replacement].id },
          },
        }))
      )
        await move(campaign, ctx.org.staff.S1, ctx.org.animateurs[replacement], lines);
      return;
    }
    if (date !== addDays(today, leaveOffset)) return;
    if (date < simFrom(campaign)) return;
    const original = await prisma.assignment.findFirst({
      where: {
        animateurId: ctx.org.animateurs[replaced].id,
        campaignId: campaign.row.id,
        status: 'approved',
      },
    });
    if (
      !original ||
      (await prisma.assignment.count({ where: { replacesAssignmentId: original.id } }))
    )
      return;
    const supervisor = ctx.org.staff.S1;
    setClock(date, '11:00');
    const proposal = await tryCall(
      supervisor.email,
      'post',
      `/assignments/${original.id}/replace`,
      {
        body: {
          animateurId: ctx.org.animateurs[replacement].id,
          fromDate: addDays(date, 1),
          reason: 'إجازة مرضية مبرّرة — تعويض مؤقت بزميلة من نفس الولاية',
        },
      },
    );
    if (proposal?.id && proposal.status === 'proposed')
      await tryCall(ctx.org.staff.centre.email, 'post', `/assignments/${proposal.id}/approve`, {
        body: {},
      });
    // Her colleague hands the leftovers back to the supervisor.
    setClock(date, '15:00');
    await handBack(campaign, ctx.org.animateurs[replaced], ctx.org.staff.S1);
  }

  // ─── Closing a campaign ────────────────────────────────────────────────────

  async function holderBalances(campaign, userId) {
    const rows = await prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        location: { campaignId: campaign.row.id, kind: 'holder', userId },
      },
      select: { stockItemId: true, quantity: true },
    });
    return rows.map((row) => ({ stockItemId: row.stockItemId, quantity: row.quantity }));
  }

  /** Gives everything a holder has back to his manager, who confirms it. */
  async function handBack(campaign, holder, manager) {
    const lines = await holderBalances(campaign, holder.id);
    if (!lines.length) return;
    const out = await tryCall(holder.email, 'post', `/campaigns/${campaign.row.id}/stock/returns`, {
      body: { destination: 'user', recipientUserId: manager.id, lines },
    });
    if (out)
      await tryCall(manager.email, 'post', `/stock/transfers/${out.id}/confirm`, {
        body: {
          lines: lines.map((line) => ({
            stockItemId: line.stockItemId,
            quantityReceived: line.quantity,
          })),
        },
      });
  }

  async function warehouseBalances(campaign) {
    const rows = await prisma.stockBalance.findMany({
      where: { quantity: { gt: 0 }, location: { campaignId: campaign.row.id, kind: 'warehouse' } },
      select: { stockItemId: true, quantity: true },
    });
    return rows.map((row) => ({ stockItemId: row.stockItemId, quantity: row.quantity }));
  }

  /** Day after the end: registration closes, the campaign is completed, all stock comes back. */
  async function closingDay(ctx, campaign) {
    const { staff, animateurs } = ctx.org;
    const D = staff.director.email;
    const { end } = datesOf(campaign);
    const day = addDays(end, 1);
    setClock(day, '09:00');
    if (campaign.tombolaId)
      await mustCall(D, 'post', `/tombolas/${campaign.tombolaId}/close`, { body: {} });
    await lifecycleService.transition(
      scopeOf(ctx.agency),
      buildUserActor(staff.director),
      campaign.row.id,
      'complete',
    );
    setClock(day, '10:00');
    for (const [key] of campaign.members) {
      const supervisor = staff[plan.supervisorKeyOf(plan.SPECS.get(key).wilayaId)];
      await handBack(campaign, animateurs[key], supervisor);
    }
    setClock(day, '14:00');
    for (const key of ['S1', 'S2', 'S3', 'S4']) {
      const regional = staff[plan.regionalKeyOf(data.STAFF[key].wilayaId)];
      await handBack(campaign, staff[key], regional);
    }
    setClock(day, '16:00');
    for (const key of ['centre', 'ouest']) {
      const lines = await holderBalances(campaign, staff[key].id);
      if (!lines.length) continue;
      const out = await tryCall(
        staff[key].email,
        'post',
        `/campaigns/${campaign.row.id}/stock/returns`,
        {
          body: { destination: 'warehouse', lines },
        },
      );
      if (out)
        await tryCall(D, 'post', `/stock/transfers/${out.id}/confirm`, {
          body: {
            lines: lines.map((line) => ({
              stockItemId: line.stockItemId,
              quantityReceived: line.quantity,
            })),
          },
        });
    }
  }

  /** Two days after the end: leftovers go back to the client, final report, campaign closed. */
  async function wrapUpDay(ctx, campaign) {
    const D = ctx.org.staff.director.email;
    const day = addDays(datesOf(campaign).end, 2);
    setClock(day, '10:00');
    const lines = await warehouseBalances(campaign);
    if (lines.length)
      await mustCall(D, 'post', `/campaigns/${campaign.row.id}/stock/returns`, {
        body: { destination: 'client', reference: `BR-${campaign.key.toUpperCase()}-001`, lines },
      });
    const kpis = await mustCall(
      D,
      'get',
      `/reports/kpis?campaignIds=${campaign.row.id}&from=${datesOf(campaign).start}&to=${datesOf(campaign).end}`,
    );
    const pdf = reportPdf([
      `Rapport final - ${campaign.name.replace(/[^\x20-\x7e]/g, '').trim() || campaign.client}`,
      `Client: ${data.CLIENTS[campaign.client].name}`,
      `Periode: ${datesOf(campaign).start} au ${datesOf(campaign).end}`,
      '',
      `Ventes (unites): ${kpis.sales?.units ?? '-'}`,
      `Nombre de ventes: ${kpis.sales?.count ?? '-'}`,
      `Acheteurs: ${kpis.customers?.buyers ?? '-'}`,
      `Taux de presence: ${kpis.attendance?.rate == null ? '-' : Math.round(kpis.attendance.rate * 100) + ' %'}`,
      `Cadeaux distribues: ${kpis.gifts?.distributedUnits ?? '-'} / ${kpis.gifts?.entitledUnits ?? '-'}`,
      '',
      'Stock rapproche, retourne au client. Tirage au sort effectue.',
    ]);
    await mustCall(D, 'post', `/campaigns/${campaign.row.id}/documents`, {
      fields: { label: 'Rapport final de la campagne' },
      files: [['file', pdf, 'rapport-final.pdf']],
    });
    setClock(addDays(day, 1), '10:00');
    await lifecycleService.transition(
      scopeOf(ctx.agency),
      buildUserActor(ctx.org.staff.director),
      campaign.row.id,
      'close',
    );
  }

  /** Three days after the end the brand draws the Tombola; a week later one prize is handed over. */
  async function drawDay(ctx, campaign) {
    const client = ctx.clients[campaign.client].portalUser.email;
    const day = addDays(datesOf(campaign).end, 3);
    setClock(day, '18:30');
    await mustCall(client, 'post', `/tombolas/${campaign.tombolaId}/draw`, {
      body: {
        clientNonce: 'nour-2026',
        prizes: campaign.prizes
          .slice(0, campaign.tombola.winners)
          .map((label, index) => ({ rank: index + 1, label })),
      },
    });
  }
  async function deliveryDay(ctx, campaign) {
    const D = ctx.org.staff.director.email;
    setClock(addDays(datesOf(campaign).end, 9), '14:00');
    const winners = await mustCall(
      D,
      'get',
      `/tombolas/${campaign.tombolaId}/winners?personal=true`,
    );
    const first =
      (Array.isArray(winners) ? winners : (winners.items ?? [])).find(
        (w) => w.status === 'winner' || w.rank === 1,
      ) ?? (Array.isArray(winners) ? winners[0] : null);
    if (first)
      await mustCall(D, 'post', `/tombolas/${campaign.tombolaId}/winners/${first.id}/delivered`, {
        body: { deliveredAt: addDays(datesOf(campaign).end, 9) },
      });
  }

  /** Everything that happens on `date` besides the field activity itself. */
  async function hooks(ctx, date) {
    for (const campaign of ctx.campaigns.filter((c) => c.status === 'closed')) {
      const { end } = datesOf(campaign);
      if (date === addDays(end, 1)) await closingDay(ctx, campaign);
      if (date === addDays(end, 2)) await wrapUpDay(ctx, campaign);
      if (date === addDays(end, 3)) await drawDay(ctx, campaign);
      if (date === addDays(end, 9)) await deliveryDay(ctx, campaign);
    }
    await replacementOn(ctx, date);
    await issuesOn(ctx, date);
    await announcementsOn(ctx, date);
  }

  // ─── Final touches ─────────────────────────────────────────────────────────

  /** Proof photos the agency shares with the client, and stamps the history rows that took the
   * database clock with the simulated time they belong to. */
  async function finishingTouches(ctx) {
    for (const campaign of ctx.campaigns) {
      if (campaign.status === 'planning') continue;
      const photos = await prisma.visitPhoto.findMany({
        where: { visit: { campaignId: campaign.row.id } },
        orderBy: [{ createdAt: 'asc' }, { fileId: 'asc' }],
        take: 4,
      });
      for (const row of photos)
        await tryCall(ctx.org.staff.director.email, 'patch', `/files/${row.fileId}/visibility`, {
          body: { visibility: 'client_visible' },
        });
    }
    for (const spec of data.ISSUES)
      await prisma.issue.updateMany({
        where: { agencyId: ctx.agency.id, title: spec.title },
        data: { createdAt: at(addDays(today, -spec.age), '14:10') },
      });
    const automatic = await prisma.issue.findMany({
      where: { agencyId: ctx.agency.id, category: 'stock_shortage' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const issue of automatic)
      await prisma.issue.update({
        where: { id: issue.id },
        data: { createdAt: at(addDays(today, -Math.floor(rand(issue.id) * 3)), '16:25') },
      });
    for (const spec of data.ANNOUNCEMENTS)
      await prisma.announcement.updateMany({
        where: { agencyId: ctx.agency.id, title: spec.title },
        data: { createdAt: at(addDays(today, -spec.age), '09:00') },
      });
  }

  // ─── Entry points ──────────────────────────────────────────────────────────

  async function loadContext(agencyCode) {
    const agency = await prisma.agency.findUnique({ where: { code: agencyCode } });
    const campaignRows = agency
      ? await prisma.campaign.findMany({
          where: { agencyId: agency.id },
          orderBy: { startDate: 'asc' },
        })
      : [];
    if (!agency || campaignRows.length < data.CAMPAIGNS.length)
      throw new ShowcaseRefusal('Nothing to refresh: run `npm run seed:showcase` first.');
    const org = await orgFromDatabase(agency);
    const campaigns = [];
    const clients = {};
    for (const spec of data.CAMPAIGNS) {
      const row = campaignRows.find((c) => c.name === spec.name);
      if (!row)
        throw new ShowcaseRefusal('The demo campaigns are missing: run `npm run seed:showcase`.');
      if (!clients[spec.client]) {
        const client = await prisma.client.findFirstOrThrow({
          where: { agencyId: agency.id, name: data.CLIENTS[spec.client].name },
        });
        clients[spec.client] = {
          client,
          portalUser: await prisma.user.findUniqueOrThrow({
            where: { email: emailOf(data.CLIENTS[spec.client].portal.email) },
          }),
          ...(await catalogOf(client, spec.client)),
        };
      }
      const start = row.startDate.toISOString().slice(0, 10);
      const end = row.endDate.toISOString().slice(0, 10);
      campaigns.push({
        ...spec,
        startOffset: daysBetween(today, start),
        endOffset: daysBetween(today, end),
        row,
        ...clients[spec.client],
        client: spec.client,
        members: [],
      });
    }
    return { agency, org, campaigns, clients, today };
  }

  async function orgFromDatabase(agency) {
    const users = await prisma.user.findMany({ where: { agencyId: agency.id } });
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const staff = Object.fromEntries(
      Object.entries(data.STAFF).map(([key, spec]) => [key, byEmail.get(emailOf(spec.email))]),
    );
    const animateurs = Object.fromEntries(
      data.ANIMATEURS.map(([key]) => [key, byEmail.get(emailOf(key))]),
    );
    const rows = await prisma.pointOfSale.findMany({ where: { agencyId: agency.id } });
    return { staff, animateurs, stores: Object.fromEntries(rows.map((s) => [s.code, s])) };
  }

  async function refreshToday(ctx, nowHHMM) {
    ctxRef = ctx;
    const live = ctx.campaigns.some(
      (c) => c.status === 'active' && c.startOffset <= 0 && c.endOffset >= 0,
    );
    if (!live)
      throw new ShowcaseRefusal(
        'No active campaign covers today: run `npm run seed:showcase` again.',
      );
    await runDay(ctx, today, nowHHMM);
    await supervisorVisits(ctx, today);
    await hooks(ctx, today);
  }

  async function buildAll({ agencyCode, password, nowHHMM }) {
    passwordHash = await hashPassword(password);
    const agency = await ensureAgency(agencyCode);
    log(`Agency ${agency.name} (${agency.code})`);
    const org = await setupOrganization(agency);
    log(
      `  ${data.ANIMATEURS.length} animateurs, ${data.STORES.length} stores, supervisors, managers`,
    );
    const clients = {};
    for (const key of Object.keys(data.CLIENTS)) {
      const base = await setupClient(agency, key);
      clients[key] = { ...base, ...(await catalogOf(base.client, key)) };
    }
    const ctx = { agency, org, clients, campaigns: [], today };
    ctxRef = ctx;
    for (const spec of data.CAMPAIGNS) {
      const campaign = await setupCampaign(ctx, spec);
      ctx.campaigns.push(campaign);
      log(`  campaign ready (${spec.status}): ${spec.name}`);
    }
    for (const campaign of ctx.campaigns.filter((c) => c.status !== 'planning'))
      await distributeStock(ctx, campaign);

    const first = Math.min(
      ...ctx.campaigns
        .filter((c) => c.status !== 'planning')
        .map((c) => daysBetween(today, simFrom(c))),
    );
    for (let offset = first; offset <= 0; offset++) {
      const date = addDays(today, offset);
      log(`Day ${date} (${offset === 0 ? 'today' : -offset + ' days ago'})`);
      await runDay(ctx, date, offset === 0 ? nowHHMM : '23:59');
      await supervisorVisits(ctx, date);
      await hooks(ctx, date);
    }
    await finishingTouches(ctx);
    return ctx;
  }

  return { failures, loadContext, refreshToday, buildAll, ctx: () => ctxRef };
}
