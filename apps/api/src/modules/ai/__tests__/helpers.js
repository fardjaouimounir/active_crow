// Test doubles for the AI module: a fake AI service (HTTP server), the callback caller and a
// campaign with a sales target and some sales.
import { createServer } from 'node:http';
import request from 'supertest';
import { day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { attendanceRule, offsetDate } from '../../campaigns/__tests__/fixtures.js';

export const INBOUND_KEY = 'i'.repeat(48);
export const OUTBOUND_KEY = 'o'.repeat(48);
export const CALLBACK_PATH = '/api/v1/internal/ai/results';

/**
 * A fake AI service. `state.handler(call, n)` returns `{ status, body, after }`; the default
 * answers 202 queued. `after(call)` runs once the response is sent (it plays the callback).
 */
export async function startFakeAi() {
  const calls = [];
  const state = { handler: () => ({ status: 202, body: { data: { status: 'queued' } } }) };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const call = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        text,
        body: text ? JSON.parse(text) : null,
      };
      calls.push(call);
      const reply = await state.handler(call, calls.length);
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body ?? {}));
      // supertest requests are lazy: awaiting is what sends them.
      if (reply.after) setImmediate(async () => await reply.after(call));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** What the AI service sends back, built per capability. */
export const outputs = {
  happy: {
    supervisor_daily_summary: {
      locale: 'en',
      headline: 'Attendance was 84% and sales grew.',
      summary: ['One', 'Two', 'Three'],
      attention: [{ type: 'attendance', text: 'Two late check-ins', refs: [] }],
      recommendedActions: ['Call the late team'],
      kpis: { attendanceRate: 0.84 },
    },
    sales_performance: {
      locale: 'en',
      ranking: [{ label: 'S1', units: 12 }],
      trends: ['Rising'],
      anomalies: [],
      recommendedActions: [],
      kpis: {},
    },
    campaign_insights: {
      locale: 'en',
      narrative: 'The campaign is on track.',
      risks: [{ severity: 'high', text: 'Gift stock is low', evidence: ['gifts'] }],
      opportunities: ['More stores'],
      decisions: ['Restock'],
      kpis: {},
    },
    animateur_coaching: {
      locale: 'en',
      coaching: [
        { label: 'A1', strengths: ['Sales'], gaps: [], actions: ['Keep going'], evidenceRefs: [] },
      ],
      campaignActions: [],
      kpis: {},
    },
  },
  arabic: {
    locale: 'ar',
    headline: 'كان الحضور جيدًا والمبيعات في ارتفاع.',
    summary: ['أولًا', 'ثانيًا', 'ثالثًا'],
    attention: [],
    recommendedActions: [],
    kpis: {},
  },
  empty: { error: { code: 'NEEDS_DATA', message: 'Not enough data' } },
  malformedOutput: { error: { code: 'AI_VALIDATION_FAILED', message: 'Model output invalid' } },
  providerError: { error: { code: 'AI_UNAVAILABLE', message: 'Provider down' } },
  piiFirewall: { error: { code: 'PII_FIREWALL', message: 'Payload rejected' } },
};

export const callbackBody = (requestId, capability, output, extra = {}) => ({
  requestId,
  capability,
  modelVersion: 'Qwen/Qwen3.8-27B@prompt-v1',
  confidence: 0.95,
  output,
  ...extra,
});

/** Plays the AI service: POSTs to our callback route with the outbound key. */
export function postCallback(app, body, key = OUTBOUND_KEY) {
  const req = request(app).post(CALLBACK_PATH);
  if (key) req.set('Authorization', `Bearer ${key}`);
  return req.send(body);
}

/** Gives the world campaign an approved attendance rule, and (by default) a daily sales target. */
export async function addRules(world, built, { target = 10 } = {}) {
  const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: built.id } });
  await prisma.ruleSet.update({
    where: { id: ruleSet.id },
    data: { effectiveFrom: built.campaign.startDate },
  });
  const base = { agencyId: world.agency.id, ruleSetId: ruleSet.id };
  await prisma.campaignRule.create({
    data: { ...base, ruleType: 'attendance', config: attendanceRule },
  });
  if (target)
    await prisma.campaignRule.create({
      data: {
        ...base,
        ruleType: 'sales_target',
        config: { dailyUnitsPerAnimateur: target, perProduct: [] },
      },
    });
  return ruleSet;
}

/** A recorded sale of `quantity` units by the campaign Animateur, `daysAgo` days ago. */
export async function addSale(world, built, ruleSet, quantity, daysAgo = 1) {
  const sale = await prisma.sale.create({
    data: {
      agencyId: world.agency.id,
      campaignId: built.id,
      assignmentId: built.assignment.id,
      pointOfSaleId: built.pointOfSale.id,
      animateurId: built.animateur.id,
      supervisorId: world.people.supervisor.id,
      ruleSetId: ruleSet.id,
      workDate: day(offsetDate(-daysAgo)),
    },
  });
  await prisma.saleItem.create({
    data: {
      agencyId: world.agency.id,
      saleId: sale.id,
      productId: built.product.id,
      quantity,
    },
  });
  return sale;
}
