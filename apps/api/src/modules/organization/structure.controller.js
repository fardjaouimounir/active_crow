import { ScopeService } from '../../core/authz/index.js';
import { structureService as service } from './structure.service.js';

const scope = (req) => ScopeService.forRequest(req);

export async function regions(req, res) {
  res.json({ data: await service.listRegions(scope(req)) });
}

export async function createRegion(req, res) {
  res.status(201).json({ data: await service.createRegion(scope(req), req.actor, req.body) });
}

export const changeRegion = (action) => async (req, res) => {
  const data = await service.updateRegion(scope(req), req.actor, req.params.id, req.body, action);
  if (action === 'deleted') res.status(204).end();
  else res.json({ data });
};

export async function points(req, res) {
  res.json(await service.listPoints(scope(req), req.query));
}

export async function point(req, res) {
  res.json({ data: await service.point(scope(req), req.params.id) });
}

export async function createPoint(req, res) {
  res.status(201).json({ data: await service.createPoint(scope(req), req.actor, req.body) });
}

export async function updatePoint(req, res) {
  res.json({ data: await service.updatePoint(scope(req), req.actor, req.params.id, req.body) });
}

export async function deletePoint(req, res) {
  await service.deletePoint(scope(req), req.actor, req.params.id);
  res.status(204).end();
}
