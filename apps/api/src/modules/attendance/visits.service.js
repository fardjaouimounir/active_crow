import { ScopeService } from '../../core/authz/scopeService.js';
import { ValidationError } from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { runIdempotent } from '../../core/http/idempotency.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { fileService } from '../files/files.service.js';
import { issueService } from '../issues/issues.service.js';
import * as repository from './attendance.repository.js';
import { problem, required } from './attendance.service.js';
import { activeAssignments, algiersInstant } from './expected.js';

export async function createVisit(req) {
  const { actor, body, files, params } = req;
  const scope = ScopeService.resolve(actor);
  const visitedAt = clock.now();
  const date = businessDate(visitedAt);
  const campaignId = params.id;
  return runIdempotent(
    req,
    async (tx) => {
      await repository.lockCampaign(tx, scope, campaignId);
      const campaign = required(await repository.campaign(tx, scope, campaignId));
      const { pointOfSaleId, issues, observedAnimateurIds, ...fields } = body;
      const point = required(await repository.visitPoint(tx, scope, campaignId, pointOfSaleId));
      const assignments = await activeAssignments(tx, scope, date, { campaignId, pointOfSaleId });
      if (scope.level === 'supervisor') {
        required(assignments.some((assignment) => assignment.supervisorId === actor.id));
      }
      if (campaign.status !== 'active') {
        throw problem('FIELD_ENTRY_NOT_ALLOWED', 422, 'Campaign is not active', {
          reason: 'campaign_not_active',
        });
      }
      if (observedAnimateurIds.some((id) => !assignments.some((row) => row.animateurId === id))) {
        throw problem(
          'INVALID_OBSERVED',
          422,
          'Observed Animateurs must work at this point of sale today',
        );
      }
      if (!files?.length) {
        throw new ValidationError([{ path: 'body.photos', message: 'Upload 1–5 photos' }]);
      }
      const photos = [];
      for (const file of files) {
        const saved = await fileService.store(tx, {
          actor,
          kind: 'visit_photo',
          buffer: file.buffer,
        });
        photos.push({ agencyId: actor.agencyId, fileId: saved.id });
      }
      const row = await repository.createVisit(tx, scope, {
        ...fields,
        pointOfSaleId: point.pointOfSaleId,
        campaignId,
        supervisorId: actor.id,
        visitedAt,
        observedAnimateurIds: [...new Set(observedAnimateurIds)],
        photos: { create: photos },
      });
      const linked = [];
      for (const issue of issues) {
        linked.push(
          await issueService.createInTransaction(tx, actor, {
            ...issue,
            campaignId,
            pointOfSaleId,
            visitId: row.id,
          }),
        );
      }
      events.emit(tx, 'visit.recorded', {
        agencyId: actor.agencyId,
        actorId: actor.id,
        campaignId,
        visitId: row.id,
        pointOfSaleId,
      });
      return { ...row, issues: linked };
    },
    { status: 201, transaction: fileService.transaction },
  );
}

export async function listVisits(actor, campaignId, filters) {
  const scope = ScopeService.resolve(actor);
  const { from, to, ...where } = filters;
  const end = new Date(+algiersInstant(to, '00:00') + 86_400_000);
  const visits = await repository.visits(prisma, scope, {
    campaignId,
    visitedAt: { gte: algiersInstant(from, '00:00'), lt: end },
  });
  if (!visits.length) required(await repository.campaign(prisma, scope, campaignId));
  return visits.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

export async function visitOptions(actor, campaignId) {
  const scope = ScopeService.resolve(actor);
  required(await repository.campaign(prisma, scope, campaignId));
  const assignments = await activeAssignments(prisma, scope, businessDate(), { campaignId });
  const options = [];
  for (const { pointOfSale } of await repository.visitPoints(prisma, scope, campaignId)) {
    const rows = assignments.filter((row) => row.pointOfSaleId === pointOfSale.id);
    if (scope.level === 'supervisor' && !rows.some((row) => row.supervisorId === actor.id))
      continue;
    if (
      scope.level === 'regional' &&
      !(await repository.visitPoint(prisma, scope, campaignId, pointOfSale.id))
    )
      continue;
    options.push({
      id: pointOfSale.id,
      name: pointOfSale.name,
      animateurs: [...new Map(rows.map(({ animateur }) => [animateur.id, animateur])).values()],
    });
  }
  return options;
}

export async function visitDetail(actor, id) {
  const scope = ScopeService.resolve(actor);
  const [row] = await repository.visits(prisma, scope, { id });
  required(row);
  const observedAnimateurs = await repository.observed(prisma, scope, row.observedAnimateurIds);
  return { ...row, observedAnimateurs };
}
