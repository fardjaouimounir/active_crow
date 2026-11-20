// A builder that leaks a phone-shaped label must end in send_failed and never reach the network.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { prisma } from '../../../db/client.js';
import { createStockWorld } from '../../inventory/__tests__/helpers.js';
import { createApp } from '../../../app.js';
import { aiConfig } from '../ai.config.js';
import { INBOUND_KEY, OUTBOUND_KEY, startFakeAi } from './helpers.js';

vi.mock('../aiPayloads.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    payloadBuilders: {
      ...original.payloadBuilders,
      supervisor_daily_summary: () => ({
        data: { attendance: { present: 1, expected: 2 }, note: '0555 12 34 56' },
        labelMap: {},
      }),
    },
  };
});

let world;
let fake;
let restore;
beforeAll(async () => {
  world = await createStockWorld(createApp());
  fake = await startFakeAi();
  restore = aiConfig.override({
    baseUrl: fake.url,
    inboundKey: INBOUND_KEY,
    outboundKey: OUTBOUND_KEY,
  });
});
afterAll(async () => {
  restore();
  await fake.close();
});

it('a payload with a phone-shaped value is send_failed, logged as an error, never sent', async () => {
  const { aiService } = await import('../ai.service.js');
  const { logger } = await import('../../../config/logger.js');
  const error = vi.spyOn(logger, 'error');
  const request = await prisma.aiRequest.create({
    data: {
      requestId: randomUUID(),
      agencyId: world.agency.id,
      capability: 'supervisor_daily_summary',
      subjectType: 'supervisor',
      subjectId: world.people.supervisor.id,
      filters: {
        supervisorIds: [world.people.supervisor.id],
        from: '2026-01-05',
        to: '2026-01-05',
        workDate: '2026-01-05',
        locale: 'en',
      },
      requestedById: world.people.director.id,
    },
  });
  await aiService.processRequest({ aiRequestId: request.id });
  const saved = await prisma.aiRequest.findUniqueOrThrow({ where: { id: request.id } });
  expect(saved.status).toBe('send_failed');
  expect(saved.lastError).toContain('AI_PII_GUARD');
  expect(saved.lastError).not.toContain('0555');
  expect(fake.calls).toHaveLength(0);
  expect(error).toHaveBeenCalled();
  expect(JSON.stringify(error.mock.calls)).not.toContain('0555 12 34 56');
});
