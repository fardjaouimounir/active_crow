// "Today so far" is compared with the same weekday last week up to the same time, not with a full
// day; after the shift (20:00) it becomes full day against full day.
import { beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { clock } from '../../../core/time/clock.js';
import { prisma } from '../../../db/client.js';
import { createSale, day } from '../../../db/__tests__/factories.js';
import { createStockWorld } from '../../inventory/__tests__/helpers.js';
import { reportingService, sameTimeLastWeek } from '../reporting.service.js';

let world;
beforeAll(async () => {
  world = await createStockWorld(createApp());
});

const at = (date, time) => new Date(`${date}T${time}:00+01:00`);
const TODAY = '2026-11-20'; // a Friday
const LAST_FRIDAY = '2026-11-13';

it('sameTimeLastWeek: 7 × 24 h earlier during the shift, the whole day after it or for a past day', () => {
  const morning = at(TODAY, '11:30');
  expect(sameTimeLastWeek(TODAY, morning)).toEqual({
    date: LAST_FRIDAY,
    until: at(LAST_FRIDAY, '11:30'),
    sameTime: true,
  });
  expect(sameTimeLastWeek(TODAY, at(TODAY, '20:00'))).toMatchObject({
    until: null,
    sameTime: false,
  });
  expect(sameTimeLastWeek(TODAY, at(TODAY, '23:10'))).toMatchObject({
    until: null,
    sameTime: false,
  });
  expect(sameTimeLastWeek('2026-11-18', morning)).toMatchObject({
    date: '2026-11-11',
    until: null,
  });
});

it('KPIs and the AI summary compare today so far with last Friday up to the same time', async () => {
  const built = await world.campaign({ startDate: day('2026-11-01') });
  const { campaign, assignment } = built;
  const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const sell = (date, time, quantity) =>
    createSale(
      { supervisor: world.people.supervisor, ruleSet, ...built, agency: world.agency },
      {
        assignmentId: assignment.id,
        workDate: day(date),
        soldAt: at(date, time),
        items: {
          create: { agencyId: world.agency.id, productId: built.product.id, quantity },
        },
      },
    );
  await sell(LAST_FRIDAY, '09:00', 2);
  await sell(LAST_FRIDAY, '15:00', 5);
  await sell(TODAY, '10:00', 3);

  const now = vi.spyOn(clock, 'now');
  try {
    const query = `/reports/kpis?campaignIds=${campaign.id}&from=${TODAY}&to=${TODAY}`;
    now.mockReturnValue(at(TODAY, '11:00'));
    const live = await world.ok(world.call('director', 'get', query));
    expect(live.sales.units).toBe(3);
    expect(live.previous.sales.units).toBe(2); // the 15:00 sale of last Friday is not counted yet
    expect(live.previous.period).toEqual({ from: LAST_FRIDAY, to: LAST_FRIDAY });
    expect(live.comparison).toEqual({ kind: 'sameTime', weekday: LAST_FRIDAY });

    // The AI daily summary uses the same comparison.
    const director = { ...world.people.director, role: 'director' };
    const actor = (await import('../../../core/auth/actor.js')).buildUserActor(director);
    const filters = { campaignIds: [campaign.id], from: TODAY, to: TODAY };
    const week = sameTimeLastWeek(TODAY, clock.now());
    const previous = await reportingService.aggregates(
      actor,
      { ...filters, from: week.date, to: week.date },
      undefined,
      { until: week.until },
    );
    expect(previous.sales.units).toBe(2);

    now.mockReturnValue(at(TODAY, '21:00'));
    const evening = await world.ok(world.call('director', 'get', query));
    expect(evening.previous.sales.units).toBe(7); // the whole of last Friday
    expect(evening.comparison).toEqual({ kind: 'sameDay', weekday: LAST_FRIDAY });
  } finally {
    now.mockRestore();
  }
});
