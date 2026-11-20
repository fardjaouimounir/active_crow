import { ScopeService } from '../../core/authz/index.js';
import { lifecycleService } from './lifecycle.service.js';
import { ruleSetsService as service } from './ruleSets.service.js';

const scope = (req) => ScopeService.forRequest(req);

export async function list(req, res) {
  res.json({ data: await service.list(scope(req), req.params.id) });
}

export async function detail(req, res) {
  res.json({ data: await service.detail(scope(req), req.params.id, req.params.rsId) });
}

export async function effective(req, res) {
  res.json({ data: await service.effective(scope(req), req.params.id, req.query.at) });
}

export async function createVersion(req, res) {
  res.status(201).json({ data: await service.createVersion(scope(req), req.actor, req.params.id) });
}

export async function discard(req, res) {
  await service.discard(scope(req), req.actor, req.params.id, req.params.rsId);
  res.status(204).end();
}

export async function saveRule(req, res) {
  const { id, rsId, ruleType } = req.params;
  res.json({ data: await service.saveRule(scope(req), req.actor, id, rsId, ruleType, req.body) });
}

export async function removeRule(req, res) {
  const { id, rsId, ruleType } = req.params;
  await service.removeRule(scope(req), req.actor, id, rsId, ruleType);
  res.status(204).end();
}

export async function savePromotions(req, res) {
  const { id, rsId } = req.params;
  res.json({
    data: await service.savePromotions(scope(req), req.actor, id, rsId, req.body),
  });
}

export async function approve(req, res) {
  const { id, rsId } = req.params;
  res.json({ data: await service.approve(scope(req), req.actor, id, rsId) });
}

export async function readiness(req, res) {
  res.json({ data: await lifecycleService.readiness(scope(req), req.params.id) });
}

/** One handler per lifecycle action, e.g. `POST /campaigns/:id/activate`. */
export const transition = (action) => async (req, res) => {
  const data = await lifecycleService.transition(
    scope(req),
    req.actor,
    req.params.id,
    action,
    req.body,
  );
  res.json({ data });
};
