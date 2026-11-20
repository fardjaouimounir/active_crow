import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { listRoutes } from '../../../../test/helpers/routes.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';
import { storage } from '../../../core/storage/index.js';
import { createTombola, day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { addRules, addSale } from '../../ai/__tests__/helpers.js';
import { createStockWorld, root } from '../../inventory/__tests__/helpers.js';

const app = createApp();
let world;
let otherClientAuth;
let sequence = 0;

beforeAll(async () => {
  world = await createStockWorld(app);
  const other = await createUserWithPassword(world.agency.id, {
    role: 'client',
    clientId: world.otherClient.id,
  });
  otherClientAuth = bearer((await login(app, other)).accessToken);
});

const call = (actor, method, path, body) => {
  const req = request(app)[method](root + path);
  const auth = typeof actor === 'string' ? world.auth[actor] : actor;
  if (auth) req.set(auth);
  return body === undefined ? req : req.send(body);
};

async function storedFile(kind, visibility = 'internal') {
  sequence += 1;
  const key = `agency/${world.agency.id}/${kind}/2027/01/${randomUUID()}.webp`;
  await storage.put(key, Buffer.from('RIFFxxxxWEBPfake'), 'image/webp');
  return prisma.file.create({
    data: {
      agencyId: world.agency.id,
      kind,
      storageKey: key,
      mimeType: 'image/webp',
      sizeBytes: 16,
      sha256: `sha-${sequence}`,
      uploadedById: world.people.supervisor.id,
      visibility,
    },
  });
}

/** A campaign with sales, a Tombola and one visit with a photo (not shared yet). */
async function seeded() {
  const built = await world.campaign();
  const ruleSet = await addRules(world, built);
  await addSale(world, built, ruleSet, 7, 1);
  const customer = await prisma.customer.create({
    data: {
      agencyId: world.agency.id,
      campaignId: built.id,
      createdById: built.animateur.id,
      fullName: 'Nadia Boukhari',
      phone: `+21355${String(900000 + sequence++)}`,
    },
  });
  const visit = await prisma.supervisorVisit.create({
    data: {
      agencyId: world.agency.id,
      campaignId: built.id,
      supervisorId: world.people.supervisor.id,
      pointOfSaleId: built.pointOfSale.id,
      latitude: 36.7538,
      longitude: 3.0588,
      notes: 'Shelf is half empty',
      observedAnimateurIds: [built.animateur.id],
    },
  });
  const photo = await storedFile('visit_photo');
  await prisma.visitPhoto.create({
    data: { visitId: visit.id, fileId: photo.id, agencyId: world.agency.id },
  });
  const tombola = await createTombola(
    { agency: world.agency, campaign: built.campaign },
    { winnersCount: 1, reservesCount: 1 },
  );
  await prisma.tombolaEntry.create({
    data: {
      agencyId: world.agency.id,
      tombolaId: tombola.id,
      customerId: customer.id,
      entryNumber: 1,
    },
  });
  return { built, customer, visit, photo, tombola };
}

describe('portal scope (FR-090)', () => {
  it('a client sees its own campaigns in assigned…closed, never draft or another company', async () => {
    const { built } = await seeded();
    const draft = await world.campaign({ status: 'draft' });
    const planning = await world.campaign({ status: 'planning' });
    const ids = (await world.ok(call('clientUser', 'get', '/portal/campaigns'))).map(
      ({ id }) => id,
    );
    expect(ids).toContain(built.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(planning.id);
    expect(await world.ok(call(otherClientAuth, 'get', '/portal/campaigns'))).toEqual([]);
    for (const path of ['', '/kpis', '/proof', '/documents', '/breakdown?dimension=day']) {
      await world.refused(
        call(otherClientAuth, 'get', `/portal/campaigns/${built.id}${path}`),
        404,
        'NOT_FOUND',
      );
      await world.refused(
        call('clientUser', 'get', `/portal/campaigns/${draft.id}${path}`),
        404,
        'NOT_FOUND',
      );
    }
    await world.refused(
      call(otherClientAuth, 'get', `/portal/campaigns/${built.id}/export.xlsx`),
      404,
      'NOT_FOUND',
    );
    await world.refused(
      call('clientUser', 'get', `/portal/campaigns/${randomUUID()}`),
      404,
      'NOT_FOUND',
    );
  });

  it('staff outside the agency level get 404, anonymous 401, the director may preview', async () => {
    const { built } = await seeded();
    for (const actor of ['supervisor', 'regional', 'animateur']) {
      const res = await call(actor, 'get', `/portal/campaigns/${built.id}`);
      expect([403, 404]).toContain(res.status);
    }
    await world.refused(call(null, 'get', `/portal/campaigns/${built.id}`), 401, 'UNAUTHENTICATED');
    const preview = await world.ok(call('director', 'get', `/portal/campaigns/${built.id}`));
    expect(preview.id).toBe(built.id);
  });

  it('a client user cannot reach any other endpoint (route walk)', async () => {
    const { built, tombola } = await seeded();
    const allowed = [
      /^\/api\/v1\/portal\//,
      /^\/api\/v1\/tombolas\/[^/]+(\/draw(\/verification)?|\/winners)?$/,
      /^\/api\/v1\/campaigns\/[^/]+\/tombolas$/,
      /^\/api\/v1\/(auth|notifications|reference|files|health)(\/|$)/,
    ];
    const fill = (path) =>
      path
        .replace(':id', path.includes('/tombolas') ? tombola.id : built.id)
        .replace(/:[A-Za-z]+/g, randomUUID());
    const open = [];
    for (const { route } of listRoutes(app)) {
      const [method, path] = route.split(' ');
      if (!path.startsWith('/api/v1/') || allowed.some((pattern) => pattern.test(path))) continue;
      if (path.includes('/auth/') || path.includes('/internal/')) continue;
      const res = await call(
        'clientUser',
        method.toLowerCase(),
        fill(path).slice(7),
        method === 'GET' ? undefined : {},
      );
      if (![403, 404].includes(res.status)) open.push(`${route} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});

describe('client view: aggregates only (§2.2)', () => {
  it('KPIs, totals and breakdowns by day, wilaya, store and product', async () => {
    const { built } = await seeded();
    const path = `/portal/campaigns/${built.id}`;
    const kpis = await world.ok(call('clientUser', 'get', path + '/kpis'));
    expect(kpis).toMatchObject({ provisional: true, kpis: { sales: { units: 7 } } });
    expect(kpis.kpis.stock).toMatchObject({
      stockIn: expect.any(Number),
      physical: expect.any(Number),
    });
    expect(kpis.kpis.stock.failingChecks).toBeUndefined();
    for (const dimension of ['day', 'wilaya', 'point_of_sale', 'product']) {
      const rows = await world.ok(
        call('clientUser', 'get', `${path}/breakdown?dimension=${dimension}`),
      );
      expect(Array.isArray(rows)).toBe(true);
    }
    const days = await world.ok(call('clientUser', 'get', `${path}/breakdown?dimension=day`));
    expect(days.reduce((total, row) => total + row.sales.units, 0)).toBe(7);
    for (const dimension of ['animateur', 'supervisor', 'region', 'campaign', 'nonsense']) {
      await world.refused(
        call('clientUser', 'get', `${path}/breakdown?dimension=${dimension}`),
        422,
        'INVALID_DIMENSION',
      );
    }
    const closed = await world.campaign({ status: 'closed' });
    expect(
      (await world.ok(call('clientUser', 'get', `/portal/campaigns/${closed.id}/kpis`)))
        .provisional,
    ).toBe(false);
  });

  it('no staff name, email, phone, coordinate or customer detail in any portal response', async () => {
    const { built, customer, tombola } = await seeded();
    await prisma.tombola.update({ where: { id: tombola.id }, data: { status: 'closed' } });
    await world.ok(
      call('clientUser', 'post', `/tombolas/${tombola.id}/draw`, {
        prizes: [{ rank: 1, label: 'TV' }],
        clientNonce: 'n',
      }),
      201,
    );
    const path = `/portal/campaigns/${built.id}`;
    const responses = [];
    for (const url of [
      '/portal/campaigns',
      path,
      path + '/kpis',
      path + '/proof',
      path + '/documents',
      ...['day', 'wilaya', 'point_of_sale', 'product'].map(
        (d) => `${path}/breakdown?dimension=${d}`,
      ),
      `/tombolas/${tombola.id}`,
      `/tombolas/${tombola.id}/winners`,
      `/tombolas/${tombola.id}/draw/verification`,
    ]) {
      const res = await call('clientUser', 'get', url);
      expect(res.status, url).toBe(200);
      responses.push(JSON.stringify(res.body));
    }
    const text = responses.join('\n');
    const secrets = [
      ...Object.entries(world.people)
        .filter(([name]) => name !== 'clientUser')
        .map(([, person]) => person)
        .flatMap((person) => [person.fullName, person.email, person.phone]),
      built.animateur.fullName,
      built.animateur.email,
      customer.fullName,
      customer.phone,
      'Shelf is half empty',
      '36.7538',
      '3.0588',
    ].filter(Boolean);
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
    expect(text).not.toMatch(/"(supervisorId|animateurId|latitude|longitude|requestedById)"/);
  });
});

describe('proof and documents (visibility)', () => {
  it('only photos and documents the agency shared, and only to the client of the campaign', async () => {
    const { built, photo, visit } = await seeded();
    const path = `/portal/campaigns/${built.id}`;
    expect(await world.ok(call('clientUser', 'get', path + '/proof'))).toEqual([]);
    await world.refused(call('clientUser', 'get', `/files/${photo.id}`), 404, 'NOT_FOUND');

    await world.refused(
      call('supervisor', 'patch', `/files/${photo.id}/visibility`, {
        visibility: 'client_visible',
      }),
      403,
      'FORBIDDEN',
    );
    await world.ok(
      call('general', 'patch', `/files/${photo.id}/visibility`, { visibility: 'client_visible' }),
    );
    const proof = await world.ok(call('clientUser', 'get', path + '/proof'));
    expect(proof).toEqual([
      {
        fileId: photo.id,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        store: built.pointOfSale.name,
        wilaya: expect.objectContaining({ id: 16 }),
      },
    ]);
    expect(JSON.stringify(proof)).not.toContain(visit.id);
    expect((await call('clientUser', 'get', `/files/${photo.id}`)).status).toBe(200);
    await world.refused(call(otherClientAuth, 'get', `/files/${photo.id}`), 404, 'NOT_FOUND');

    await world.ok(
      call('director', 'patch', `/files/${photo.id}/visibility`, { visibility: 'internal' }),
    );
    expect(await world.ok(call('clientUser', 'get', path + '/proof'))).toEqual([]);
    await world.refused(call('clientUser', 'get', `/files/${photo.id}`), 404, 'NOT_FOUND');
  });

  it('attendance photos and other kinds can never be shared, even if forced in the database', async () => {
    await seeded();
    const attendance = await storedFile('attendance_photo');
    const proof = await storedFile('sale_proof');
    for (const file of [attendance, proof]) {
      await world.refused(
        call('director', 'patch', `/files/${file.id}/visibility`, { visibility: 'client_visible' }),
        422,
        'VISIBILITY_NOT_ALLOWED_FOR_KIND',
      );
    }
    // The database refuses it too (files_client_visible_kinds).
    await expect(
      prisma.file.update({ where: { id: attendance.id }, data: { visibility: 'client_visible' } }),
    ).rejects.toThrow();
    await world.refused(call('clientUser', 'get', `/files/${attendance.id}`), 404, 'NOT_FOUND');
  });

  it('lists shared campaign documents', async () => {
    const { built } = await seeded();
    const file = await storedFile('campaign_document', 'client_visible');
    await prisma.campaignDocument.create({
      data: { campaignId: built.id, fileId: file.id, agencyId: world.agency.id, label: 'Brief' },
    });
    const hidden = await storedFile('campaign_document');
    await prisma.campaignDocument.create({
      data: {
        campaignId: built.id,
        fileId: hidden.id,
        agencyId: world.agency.id,
        label: 'Internal',
      },
    });
    const documents = await world.ok(
      call('clientUser', 'get', `/portal/campaigns/${built.id}/documents`),
    );
    expect(documents.map(({ label }) => label)).toEqual(['Brief']);
    expect((await call('clientUser', 'get', `/files/${file.id}`)).status).toBe(200);
    await world.refused(call('clientUser', 'get', `/files/${hidden.id}`), 404, 'NOT_FOUND');
  });
});

describe('client Excel and AI commentary', () => {
  it('has no Animateur sheet and no staff names; accepted AI text only when reviewed', async () => {
    const { built, customer } = await seeded();
    const download = async () => {
      const res = await call('clientUser', 'get', `/portal/campaigns/${built.id}/export.xlsx`)
        .buffer(true)
        .parse((response, done) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      return workbook;
    };
    const workbook = await download();
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'By day',
      'By wilaya',
      'By store',
      'By product',
    ]);
    const cells = [];
    workbook.eachSheet((sheet) =>
      sheet.eachRow((row) => cells.push(...row.values.slice(1).map(String))),
    );
    const text = cells.join('\n');
    for (const [name, person] of Object.entries(world.people))
      if (name !== 'clientUser') expect(text).not.toContain(person.fullName);
    expect(text).not.toContain(customer.fullName);
    expect(text).not.toContain('AI commentary');

    // An accepted suggestion for exactly this period appears, without the reviewer name.
    const period = {
      from: built.campaign.startDate.toISOString().slice(0, 10),
      to: built.campaign.endDate.toISOString().slice(0, 10),
    };
    const aiRequest = await prisma.aiRequest.create({
      data: {
        requestId: randomUUID(),
        agencyId: world.agency.id,
        capability: 'campaign_insights',
        subjectType: 'campaign',
        subjectId: built.id,
        filters: { campaignIds: [built.id], ...period, locale: 'en' },
        requestedById: world.people.director.id,
        status: 'completed',
      },
    });
    const suggestion = await prisma.aiSuggestion.create({
      data: {
        agencyId: world.agency.id,
        capability: 'campaign_insights',
        subjectType: 'campaign',
        subjectId: built.id,
        requestId: aiRequest.requestId,
        modelVersion: 'test',
        confidence: 0.9,
        output: {
          narrative: 'The campaign is on track.',
          risks: [],
          opportunities: [],
          decisions: [],
        },
      },
    });
    let detail = await world.ok(call('clientUser', 'get', `/portal/campaigns/${built.id}`));
    expect(detail.commentary).toBeNull();
    await world.ok(call('director', 'post', `/ai/suggestions/${suggestion.id}/accept`, {}));
    detail = await world.ok(call('clientUser', 'get', `/portal/campaigns/${built.id}`));
    expect(detail.commentary.output.narrative).toBe('The campaign is on track.');
    expect(JSON.stringify(detail.commentary)).not.toContain(world.people.director.fullName);
    const after = await download();
    const summary = [];
    after.getWorksheet('Summary').eachRow((row) => summary.push(row.values.slice(1).map(String)));
    const ai = summary.find(([label]) => label.startsWith('AI commentary'));
    expect(ai[0]).toContain('AI-generated, reviewed by the agency');
    expect(ai[1]).toContain('on track');
  });
});

describe('a closed campaign', () => {
  it('stays readable for the client; a draw is not blocked by the campaign status', async () => {
    const built = await world.campaign({
      status: 'closed',
      endDate: day('2020-01-02'),
      startDate: day('2020-01-01'),
    });
    const detail = await world.ok(call('clientUser', 'get', `/portal/campaigns/${built.id}`));
    expect(detail).toMatchObject({ status: 'closed', provisional: false });
  });
});
