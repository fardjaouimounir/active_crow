import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../../../../prisma/seed/demo.js';
import { createApp } from '../../../app.js';
import {
  createAgency,
  createCampaign,
  createClient,
  createProduct,
  createRuleSet,
  createStockItem,
  createUser,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';

const app = createApp();
const root = '/api/v1';
const auth = {};
let agency;
let otherAgency;
let portalClient;

function send(method, path, actor = 'director', body) {
  const req = request(app)[method](root + path);
  if (actor) req.set(auth[actor]);
  return body === undefined ? req : req.send(body);
}

async function ok(req, status) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data;
}

async function rejected(req, status, code) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
  return res.body.error.details;
}

const newClient = (name = 'Client ' + randomUUID()) =>
  ok(send('post', '/clients', 'director', { name }), 201);

beforeAll(async () => {
  agency = await createAgency();
  otherAgency = await createAgency();
  portalClient = await createClient(agency.id);
  for (const [name, role] of Object.entries({
    director: 'director',
    general: 'general_manager',
    supervisor: 'supervisor',
    animateur: 'animateur',
    client: 'client',
  })) {
    const user = await createUserWithPassword(agency.id, {
      role,
      clientId: role === 'client' ? portalClient.id : undefined,
    });
    auth[name] = bearer((await login(app, user)).accessToken);
  }
});

describe('FR-020 clients', () => {
  it('creates, reads, lists with counts, updates and audits a client', async () => {
    const created = await ok(
      send('post', '/clients', 'director', {
        name: 'Henkel Algérie',
        legalName: 'Henkel Algérie SPA',
        contactName: 'Karim',
        contactEmail: 'Karim@Henkel.dz',
        contactPhone: '0555123456',
      }),
      201,
    );
    expect(created).toMatchObject({
      name: 'Henkel Algérie',
      contactEmail: 'karim@henkel.dz',
      contactPhone: '+213555123456',
      counts: { products: 0, stockItems: 0, portalUsers: 0 },
    });
    await createProduct(agency.id, created.id);
    await createProduct(agency.id, created.id, { deletedAt: new Date() });
    await createStockItem(agency.id, created.id);
    const list = await send('get', '/clients?q=henkel');
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].counts).toEqual({ products: 1, stockItems: 1, portalUsers: 0 });
    const updated = await ok(
      send('patch', '/clients/' + created.id, 'director', { contactName: null }),
      200,
    );
    expect(updated.contactName).toBeNull();
    expect((await ok(send('get', '/clients/' + created.id), 200)).legalName).toBe(
      'Henkel Algérie SPA',
    );
    const actions = await prisma.auditLog.findMany({
      where: { entityId: created.id },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map(({ action }) => action)).toEqual([
      'catalog.client_created',
      'catalog.client_updated',
    ]);
  });

  it('validates input strictly', async () => {
    await rejected(send('post', '/clients', 'director', { name: '' }), 400, 'VALIDATION_FAILED');
    await rejected(
      send('post', '/clients', 'director', { name: 'x'.repeat(121) }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('post', '/clients', 'director', { name: 'Strict', agencyId: otherAgency.id }),
      400,
      'VALIDATION_FAILED',
    );
    const { id } = await newClient();
    await rejected(send('patch', '/clients/' + id, 'director', {}), 400, 'VALIDATION_FAILED');
    await rejected(send('get', '/clients/not-a-uuid'), 400, 'VALIDATION_FAILED');
  });

  it('keeps names unique per agency among non-deleted clients', async () => {
    const first = await newClient('Unique Name');
    await rejected(
      send('post', '/clients', 'director', { name: 'unique name' }),
      409,
      'CLIENT_NAME_TAKEN',
    );
    const other = await newClient('Another Name');
    await rejected(
      send('patch', '/clients/' + other.id, 'director', { name: 'UNIQUE NAME' }),
      409,
      'CLIENT_NAME_TAKEN',
    );
    await createClient(otherAgency.id, { name: 'Shared Name' });
    await newClient('Shared Name');
    await ok(send('delete', '/clients/' + first.id), 204);
    await newClient('Unique Name');
  });

  it('BR-03 refuses to delete a client with an unfinished campaign and hides deleted clients', async () => {
    const busy = await newClient();
    await createCampaign(agency.id, busy.id, { status: 'planning' });
    await rejected(send('delete', '/clients/' + busy.id), 422, 'CLIENT_IN_USE');
    const done = await newClient();
    await createCampaign(agency.id, done.id, { status: 'closed' });
    await createCampaign(agency.id, done.id, { status: 'cancelled' });
    await ok(send('delete', '/clients/' + done.id), 204);
    await rejected(send('get', '/clients/' + done.id), 404, 'NOT_FOUND');
    await rejected(send('delete', '/clients/' + done.id), 404, 'NOT_FOUND');
    const list = await send('get', '/clients?pageSize=100');
    expect(list.body.data.map(({ id }) => id)).not.toContain(done.id);
    expect(
      await prisma.auditLog.count({
        where: { entityId: done.id, action: 'catalog.client_deleted' },
      }),
    ).toBe(1);
  });

  it('scopes clients to the agency', async () => {
    const foreign = await createClient(otherAgency.id);
    await rejected(send('get', '/clients/' + foreign.id), 404, 'NOT_FOUND');
    await rejected(
      send('patch', '/clients/' + foreign.id, 'director', { name: 'Taken over' }),
      404,
      'NOT_FOUND',
    );
    await rejected(send('get', '/clients/' + foreign.id + '/products'), 404, 'NOT_FOUND');
  });
});

describe('FR-021 products', () => {
  it('creates, lists, updates and soft-deletes products with money as decimal strings', async () => {
    const client = await newClient();
    const base = '/clients/' + client.id + '/products';
    const product = await ok(
      send('post', base, 'director', {
        sku: 'det-1kg',
        name: 'Detergent 1 kg',
        unitLabel: 'bag',
        referencePrice: '1250.50',
      }),
      201,
    );
    expect(product).toMatchObject({ sku: 'DET-1KG', referencePrice: '1250.50' });
    const row = await prisma.product.findUnique({ where: { id: product.id } });
    expect(row.referencePrice.toFixed(2)).toBe('1250.50');
    const list = await ok(send('get', base), 200);
    expect(list).toEqual([expect.objectContaining({ id: product.id, referencePrice: '1250.50' })]);
    const cleared = await ok(
      send('patch', base + '/' + product.id, 'director', { referencePrice: null }),
      200,
    );
    expect(cleared.referencePrice).toBeNull();
    expect(
      (await ok(send('patch', base + '/' + product.id, 'director', { referencePrice: '7.5' }), 200))
        .referencePrice,
    ).toBe('7.50');
    await ok(send('delete', base + '/' + product.id), 204);
    expect(await ok(send('get', base), 200)).toEqual([]);
    expect(
      await prisma.auditLog.count({
        where: { entityId: product.id, action: 'catalog.product_deleted' },
      }),
    ).toBe(1);
  });

  it('rejects floats, three decimals and malformed SKUs', async () => {
    const client = await newClient();
    const base = '/clients/' + client.id + '/products';
    const body = { sku: 'P-1', name: 'Product', unitLabel: 'unit' };
    for (const referencePrice of [1250.5, '1250.555', '-1', '1000000000000']) {
      await rejected(
        send('post', base, 'director', { ...body, referencePrice }),
        400,
        'VALIDATION_FAILED',
      );
    }
    await rejected(
      send('post', base, 'director', { ...body, sku: '-bad' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('keeps SKUs unique per client only', async () => {
    const [first, second] = await Promise.all([newClient(), newClient()]);
    const body = { sku: 'SAME-1', name: 'Product', unitLabel: 'unit' };
    await ok(send('post', '/clients/' + first.id + '/products', 'director', body), 201);
    await rejected(
      send('post', '/clients/' + first.id + '/products', 'director', { ...body, sku: 'same-1' }),
      409,
      'SKU_TAKEN',
    );
    await ok(send('post', '/clients/' + second.id + '/products', 'director', body), 201);
  });

  it('returns 404 for a product requested under another client', async () => {
    const [owner, other] = await Promise.all([newClient(), newClient()]);
    const product = await createProduct(agency.id, owner.id);
    const path = '/clients/' + other.id + '/products/' + product.id;
    await rejected(send('patch', path, 'director', { name: 'Moved' }), 404, 'NOT_FOUND');
    await rejected(send('delete', path), 404, 'NOT_FOUND');
  });

  it('BR-03 refuses to delete a product linked to an unfinished campaign', async () => {
    const client = await newClient();
    const product = await createProduct(agency.id, client.id);
    const campaign = await createCampaign(agency.id, client.id, { status: 'active' });
    await prisma.campaignProduct.create({
      data: { campaignId: campaign.id, productId: product.id, agencyId: agency.id },
    });
    const path = '/clients/' + client.id + '/products/' + product.id;
    await rejected(send('delete', path), 422, 'PRODUCT_IN_USE');
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'closed' } });
    await ok(send('delete', path), 204);
  });
});

describe('FR-022 gifts and samples', () => {
  it('creates stock items as in the contract and filters by kind', async () => {
    const client = await newClient();
    const base = '/clients/' + client.id + '/stock-items';
    const gift = await ok(
      send('post', base, 'director', {
        kind: 'gift',
        sku: 'MUG-01',
        name: 'Branded mug',
        unitLabel: 'piece',
      }),
      201,
    );
    expect(gift).toMatchObject({
      clientId: client.id,
      kind: 'gift',
      sku: 'MUG-01',
      name: 'Branded mug',
      unitLabel: 'piece',
    });
    await ok(
      send('post', base, 'director', {
        kind: 'sample',
        sku: 'S-1',
        name: 'Sachet',
        unitLabel: 'u',
      }),
      201,
    );
    const samples = await ok(send('get', base + '?kind=sample'), 200);
    expect(samples.map(({ sku }) => sku)).toEqual(['S-1']);
    await rejected(send('get', base + '?kind=plv'), 400, 'VALIDATION_FAILED');
    await rejected(
      send('post', base, 'director', { kind: 'gift', sku: 'mug-01', name: 'Copy', unitLabel: 'u' }),
      409,
      'SKU_TAKEN',
    );
    const renamed = await ok(
      send('patch', base + '/' + gift.id, 'director', { name: 'Large mug' }),
      200,
    );
    expect(renamed.name).toBe('Large mug');
  });

  it('BR-03 refuses to delete a stock item with a non-zero balance', async () => {
    const client = await newClient();
    const item = await createStockItem(agency.id, client.id);
    const campaign = await createCampaign(agency.id, client.id, { status: 'closed' });
    const location = await prisma.stockLocation.create({
      data: { agencyId: agency.id, campaignId: campaign.id, kind: 'warehouse' },
    });
    await prisma.stockBalance.create({
      data: {
        agencyId: agency.id,
        locationId: location.id,
        stockItemId: item.id,
        locationKind: 'warehouse',
        quantity: 5,
      },
    });
    const path = '/clients/' + client.id + '/stock-items/' + item.id;
    await rejected(send('delete', path), 422, 'STOCK_ITEM_IN_USE');
    await prisma.stockBalance.updateMany({
      where: { stockItemId: item.id },
      data: { quantity: 0 },
    });
    await ok(send('delete', path), 204);
  });

  it('BR-03 allows deleting a fully distributed gift (balance only in customers)', async () => {
    const client = await newClient();
    const item = await createStockItem(agency.id, client.id);
    const campaign = await createCampaign(agency.id, client.id, { status: 'closed' });
    const location = await prisma.stockLocation.create({
      data: { agencyId: agency.id, campaignId: campaign.id, kind: 'customers' },
    });
    await prisma.stockBalance.create({
      data: {
        agencyId: agency.id,
        locationId: location.id,
        stockItemId: item.id,
        locationKind: 'customers',
        quantity: 5,
      },
    });
    await ok(send('delete', '/clients/' + client.id + '/stock-items/' + item.id), 204);
  });

  it('BR-03 refuses to delete the gift of a tier in an approved rule set', async () => {
    const client = await newClient();
    const item = await createStockItem(agency.id, client.id);
    const campaign = await createCampaign(agency.id, client.id, { status: 'active' });
    const ruleSet = await createRuleSet(campaign, { status: 'approved' });
    const promotion = await prisma.promotion.create({
      data: {
        agencyId: agency.id,
        ruleSetId: ruleSet.id,
        type: 'gift_with_purchase',
        name: 'Buy one',
      },
    });
    await prisma.promotionTier.create({
      data: {
        agencyId: agency.id,
        promotionId: promotion.id,
        stockItemId: item.id,
        minQuantity: 1,
        giftQuantity: 1,
      },
    });
    const path = '/clients/' + client.id + '/stock-items/' + item.id;
    await rejected(send('delete', path), 422, 'STOCK_ITEM_IN_USE');
    await prisma.ruleSet.update({ where: { id: ruleSet.id }, data: { status: 'superseded' } });
    await ok(send('delete', path), 204);
  });

  it('returns 404 for a stock item requested under another client', async () => {
    const [owner, other] = await Promise.all([newClient(), newClient()]);
    const item = await createStockItem(agency.id, owner.id);
    await rejected(
      send('patch', '/clients/' + other.id + '/stock-items/' + item.id, 'director', { name: 'X' }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('Q-16 client portal accounts', () => {
  it('creates a portal account for an active client without a reporting line', async () => {
    const client = await newClient();
    const body = { role: 'client', clientId: client.id, fullName: 'Portal', email: 'p@client.dz' };
    const { user, temporaryPassword } = await ok(send('post', '/users', 'director', body), 201);
    expect(user).toMatchObject({ role: 'client', clientId: client.id, mustChangePassword: true });
    expect(await prisma.reportingLine.count({ where: { userId: user.id } })).toBe(0);
    const signedIn = await login(app, { email: user.email, password: temporaryPassword });
    expect(signedIn.res.body.data.user).toMatchObject({ role: 'client', mustChangePassword: true });
    const users = await send('get', '/clients/' + client.id + '/users');
    expect(users.body).toMatchObject({ data: [{ id: user.id }], meta: { total: 1 } });
    expect((await ok(send('get', '/clients/' + client.id), 200)).counts.portalUsers).toBe(1);
    const audit = await prisma.auditLog.findMany({
      where: { entityId: user.id },
      select: { before: true, after: true },
    });
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  });

  it('requires an active client of the agency, and no manager', async () => {
    const body = { role: 'client', fullName: 'Portal', email: randomUUID() + '@client.dz' };
    await rejected(send('post', '/users', 'director', body), 400, 'VALIDATION_FAILED');
    const client = await newClient();
    await rejected(
      send('post', '/users', 'director', {
        ...body,
        clientId: client.id,
        managerId: randomUUID(),
      }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('post', '/users', 'director', {
        ...body,
        role: 'animateur',
        clientId: client.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    const foreign = await createClient(otherAgency.id);
    await rejected(
      send('post', '/users', 'director', { ...body, clientId: foreign.id }),
      422,
      'CLIENT_INACTIVE',
    );
    const deleted = await createClient(agency.id, { deletedAt: new Date() });
    await rejected(
      send('post', '/users', 'director', { ...body, clientId: deleted.id }),
      422,
      'CLIENT_INACTIVE',
    );
    await rejected(
      send('post', '/users', 'director', { ...body, role: 'director' }),
      422,
      'ROLE_NOT_CREATABLE',
    );
  });

  it('deleting a client suspends its portal accounts and ends their sessions', async () => {
    const client = await createClient(agency.id);
    const member = await createUserWithPassword(agency.id, { role: 'client', clientId: client.id });
    const session = bearer((await login(app, member)).accessToken);
    expect(
      (
        await request(app)
          .get(root + '/auth/me')
          .set(session)
      ).status,
    ).toBe(200);
    await ok(send('delete', '/clients/' + client.id), 204);
    expect(
      (
        await request(app)
          .get(root + '/auth/me')
          .set(session)
      ).status,
    ).toBe(401);
    expect(await prisma.user.findUnique({ where: { id: member.id } })).toMatchObject({
      status: 'suspended',
    });
    await rejected(send('post', '/users/' + member.id + '/reactivate'), 422, 'CLIENT_INACTIVE');
  });

  it('reuses the user actions and lists only within scope', async () => {
    const client = await createClient(agency.id);
    const member = await createUser(agency.id, { role: 'client', clientId: client.id });
    await ok(send('post', '/users/' + member.id + '/suspend'), 200);
    await ok(send('post', '/users/' + member.id + '/reactivate'), 200);
    const reset = await ok(send('post', '/users/' + member.id + '/reset-password'), 200);
    expect(reset.temporaryPassword).toHaveLength(16);
    await rejected(
      send('post', '/users/' + member.id + '/transfers', 'director', {
        newManagerId: randomUUID(),
        effectiveDate: '2026-12-01',
        reason: 'No manager for portal users',
      }),
      404,
      'NOT_FOUND',
    );
    const supervisorView = await send('get', '/clients/' + client.id + '/users', 'supervisor');
    expect(supervisorView.body).toMatchObject({ data: [], meta: { total: 0 } });
    await rejected(send('get', '/clients/' + client.id + '/users', 'animateur'), 403, 'FORBIDDEN');
    const foreign = await createClient(otherAgency.id);
    await rejected(send('get', '/clients/' + foreign.id + '/users'), 404, 'NOT_FOUND');
  });
});

describe('catalog permissions', () => {
  it('lets staff read, only the director write, and keeps client accounts out', async () => {
    const client = await newClient();
    const item = await createStockItem(agency.id, client.id);
    await ok(send('get', '/clients', 'supervisor'), 200);
    await ok(send('get', '/clients/' + client.id, 'general'), 200);
    await rejected(send('post', '/clients', 'supervisor', { name: 'No' }), 403, 'FORBIDDEN');
    await rejected(
      send('patch', '/clients/' + client.id, 'general', { name: 'No' }),
      403,
      'FORBIDDEN',
    );
    await rejected(
      send('delete', '/clients/' + client.id + '/stock-items/' + item.id, 'supervisor'),
      403,
      'FORBIDDEN',
    );
    await ok(send('get', '/clients/' + client.id + '/products', 'animateur'), 200);
    await ok(send('get', '/clients/' + client.id + '/stock-items', 'animateur'), 200);
    for (const path of ['', '/' + portalClient.id, '/' + portalClient.id + '/products']) {
      await rejected(send('get', '/clients' + path, 'client'), 403, 'FORBIDDEN');
    }
    await rejected(send('get', '/clients', null), 401, 'UNAUTHENTICATED');
  });
});

it('seeds the demo catalog idempotently', async () => {
  const demoAgency = await createAgency();
  await createUser(demoAgency.id, { role: 'director' });
  const opts = {
    agency: demoAgency,
    environment: { NODE_ENV: 'test', DEMO_PASSWORD: 'Demo-Password-2026' },
  };
  await seedDemo(opts);
  await seedDemo(opts);
  const agencyId = demoAgency.id;
  expect(await prisma.client.count({ where: { agencyId } })).toBe(2);
  expect(await prisma.product.count({ where: { agencyId } })).toBe(8);
  expect(await prisma.stockItem.count({ where: { agencyId, kind: 'gift' } })).toBe(6);
  expect(await prisma.stockItem.count({ where: { agencyId, kind: 'sample' } })).toBe(2);
  const portal = await prisma.user.findMany({ where: { agencyId, role: 'client' } });
  expect(portal).toHaveLength(2);
  expect(portal.every((user) => user.isDemo && user.clientId)).toBe(true);
});
