import { ScopeService } from '../../core/authz/index.js';
import { campaignsService as service } from './campaigns.service.js';

const scope = (req) => ScopeService.forRequest(req);

export async function list(req, res) {
  res.json(await service.list(scope(req), req.query));
}

export async function detail(req, res) {
  res.json({ data: await service.detail(scope(req), req.params.id) });
}

export async function create(req, res) {
  res.status(201).json({ data: await service.create(scope(req), req.actor, req.body) });
}

/** Wraps a service write `(scope, actor, id, body)` answering 200 with its result. */
const write = (method) => async (req, res) => {
  res.json({ data: await method(scope(req), req.actor, req.params.id, req.body) });
};

export const update = write(service.update);
export const setWilayas = write(service.setWilayas);
export const setPointsOfSale = write(service.setPointsOfSale);
export const setProducts = write(service.setProducts);

export async function addStaff(req, res) {
  res
    .status(201)
    .json({ data: await service.addStaff(scope(req), req.actor, req.params.id, req.body) });
}

export async function removeStaff(req, res) {
  await service.removeStaff(scope(req), req.actor, req.params.id, req.params.staffId);
  res.status(204).end();
}

export async function documents(req, res) {
  res.json({ data: await service.documents(scope(req), req.params.id) });
}

export async function addDocument(req, res) {
  const data = await service.addDocument(scope(req), req.actor, req.params.id, {
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    label: req.body.label,
  });
  res.status(201).json({ data });
}

export async function relabelDocument(req, res) {
  const data = await service.relabelDocument(
    scope(req),
    req.actor,
    req.params.id,
    req.params.documentId,
    req.body,
  );
  res.json({ data });
}

export async function removeDocument(req, res) {
  await service.removeDocument(scope(req), req.actor, req.params.id, req.params.documentId);
  res.status(204).end();
}

export async function statusHistory(req, res) {
  res.json({ data: await service.statusHistory(scope(req), req.params.id) });
}
