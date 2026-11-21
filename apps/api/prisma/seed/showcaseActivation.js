import { buildUserActor } from '../../src/core/auth/actor.js';
import { clock } from '../../src/core/time/clock.js';
import { prisma } from '../../src/db/client.js';
import { lifecycleService } from '../../src/modules/campaigns/lifecycle.service.js';

export async function activateShowcase(campaign, director, start) {
  const scope = { level: 'agency', agencyId: campaign.agencyId };
  const where = { campaignId: campaign.id, agencyId: campaign.agencyId };
  if (await prisma.campaignStatusHistory.count({ where: { ...where, toStatus: 'active' } })) return;

  const activation = new Date(`${start}T00:00:00+01:00`);
  // Bootstrap data can have real-time draft/assignment history, even though its simulated
  // fieldwork starts earlier. Preserve the history sequence before performing the activation.
  const history = await prisma.campaignStatusHistory.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  await prisma.$transaction([
    ...history.map(({ id }, index) =>
      prisma.campaignStatusHistory.update({
        where: { id },
        data: { createdAt: new Date(+activation - (history.length - index) * 1000) },
      }),
    ),
    prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'assigned', startDate: new Date(start) },
    }),
  ]);

  const now = clock.now;
  try {
    clock.now = () => new Date(activation);
    await lifecycleService.transition(scope, buildUserActor(director), campaign.id, 'activate');
  } finally {
    clock.now = now;
  }
}
