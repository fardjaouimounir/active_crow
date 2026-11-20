// Shared fixtures for the campaign rules and lifecycle tests: one agency with a user per role, API
// helpers, and campaigns built directly in the test database.
import request from 'supertest';
import { expect } from 'vitest';
import { businessDate } from '../../../core/time/clock.js';
import {
  createAgency,
  createCampaign,
  createClient,
  createPointOfSale,
  createProduct,
  createRuleSet,
  createStockItem,
  day,
  ensureWilaya,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';

export const root = '/api/v1';

export function offsetDate(days) {
  const date = new Date(businessDate() + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const label = { ar: 'نقطة', en: 'Checkpoint' };
export const attendanceRule = {
  checkpoints: [{ code: 'morning', label, window: ['08:30', '09:30'], photo: true, gps: false }],
  lateToleranceMinutes: 15,
  autoVerifyAfterHours: null,
  maxDistanceMeters: null,
};
export const customerFieldsRule = {
  fullName: 'required',
  phone: 'optional',
  consentRequired: true,
};

/** One agency, a user per role, and `send` / `ok` / `rejected` helpers bound to the app. */
export async function createWorld(app) {
  await Promise.all([16, 31].map(ensureWilaya));
  const agency = await createAgency();
  const client = await createClient(agency.id, { name: 'Client X' });
  const otherClient = await createClient(agency.id, { name: 'Client Y' });
  const people = {};
  const auth = {};
  const roles = {
    director: { role: 'director' },
    general: { role: 'general_manager' },
    regional: { role: 'regional_manager' },
    regionalTwo: { role: 'regional_manager' },
    supervisor: { role: 'supervisor' },
    supervisorTwo: { role: 'supervisor' },
    animateur: { role: 'animateur' },
    clientUser: { role: 'client', clientId: client.id },
  };
  for (const [name, data] of Object.entries(roles)) {
    people[name] = await createUserWithPassword(agency.id, data);
    auth[name] = bearer((await login(app, people[name])).accessToken);
  }

  function send(method, path, actor = 'director', body) {
    const req = request(app)[method](root + path);
    if (actor) req.set(auth[actor]);
    return body === undefined ? req : req.send(body);
  }
  async function ok(req, status = 200) {
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

  const world = { app, agency, client, otherClient, people, auth, send, ok, rejected };

  /** A draft campaign created through the API, with the client's products linked. */
  world.draftCampaign = async (overrides = {}, productCount = 2) => {
    const campaign = await ok(
      send('post', '/campaigns', 'director', {
        clientId: client.id,
        name: 'Rules ' + Math.random().toString(36).slice(2, 8),
        startDate: offsetDate(10),
        endDate: offsetDate(40),
        ...overrides,
      }),
      201,
    );
    const products = [];
    for (let index = 0; index < productCount; index++) {
      products.push(await createProduct(agency.id, client.id));
    }
    if (productCount) {
      await ok(
        send('put', `/campaigns/${campaign.id}/products`, 'director', {
          productIds: products.map((product) => product.id),
        }),
      );
    }
    const draft = await prisma.ruleSet.findFirst({ where: { campaignId: campaign.id } });
    return { campaign, products, ruleSetId: draft.id };
  };

  world.gift = (data) => createStockItem(agency.id, client.id, { kind: 'gift', ...data });
  world.sample = (data) => createStockItem(agency.id, client.id, { kind: 'sample', ...data });

  /**
   * A campaign built directly in the database that satisfies every transition guard, then forced to
   * `status`: a wilaya needing animateurs, supervisor and regional manager on staff, a point of sale,
   * a product, an approved rule set, an approved assignment and (by default) running dates.
   */
  world.readyCampaign = async ({
    status = 'draft',
    startDate = day(offsetDate(-5)),
    endDate = day(offsetDate(30)),
    ...data
  } = {}) => {
    const campaign = await createCampaign(agency.id, client.id, {
      status,
      startDate,
      endDate,
      ...data,
    });
    const base = { campaignId: campaign.id, agencyId: agency.id };
    await prisma.campaignWilaya.create({ data: { ...base, wilayaId: 16, requiredAnimateurs: 2 } });
    await prisma.campaignStaff.createMany({
      data: [
        { ...base, wilayaId: 16, userId: people.regional.id, role: 'regional_manager' },
        { ...base, wilayaId: 16, userId: people.supervisor.id, role: 'supervisor' },
      ],
    });
    const pointOfSale = await createPointOfSale(agency.id, { wilayaId: 16 });
    await prisma.campaignPointOfSale.create({ data: { ...base, pointOfSaleId: pointOfSale.id } });
    const product = await createProduct(agency.id, client.id);
    await prisma.campaignProduct.create({ data: { ...base, productId: product.id } });
    await createRuleSet(campaign, { status: 'approved', effectiveFrom: new Date() });
    // One animateur per campaign: assignments of the same person cannot overlap across campaigns.
    const animateur = await createUserWithPassword(agency.id, { role: 'animateur' });
    await prisma.assignment.create({
      data: {
        ...base,
        animateurId: animateur.id,
        pointOfSaleId: pointOfSale.id,
        supervisorId: people.supervisor.id,
        proposedById: people.director.id,
        startDate,
        endDate,
        status: 'approved',
      },
    });
    return { campaign, pointOfSale, product, animateur };
  };

  return world;
}
