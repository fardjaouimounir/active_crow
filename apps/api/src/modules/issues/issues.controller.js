import { issueService as service } from './issues.service.js';
import { runIdempotent, sendIdempotent } from '../../core/http/idempotency.js';
import { fileService } from '../files/files.service.js';
export async function list(req, res) {
  const data = await service.list(req.actor, req.query);
  res.status(200).json(data);
}
export async function create(req, res) {
  if (req.idempotency) {
    const result = await runIdempotent(
      req,
      (tx) => service.create(req.actor, req.body, req.files ?? [], (work) => work(tx)),
      { transaction: fileService.transaction, status: 201 },
    );
    return sendIdempotent(res, result);
  }
  const data = await service.create(req.actor, req.body, req.files ?? []);
  res.status(201).json({ data });
}
export async function detail(req, res) {
  const data = await service.detail(req.actor, req.params.id);
  res.status(200).json({ data });
}
export async function comments(req, res) {
  const data = await service.comments(req.actor, req.params.id);
  res.status(200).json({ data });
}
export async function comment(req, res) {
  const data = await service.comment(req.actor, req.params.id, req.body, req.files ?? []);
  res.status(201).json({ data });
}
export async function assign(req, res) {
  const data = await service.change(req.actor, req.params.id, 'assign', req.body);
  res.status(200).json({ data });
}
export async function start(req, res) {
  const data = await service.change(req.actor, req.params.id, 'start', req.body);
  res.status(200).json({ data });
}
export async function resolve(req, res) {
  const data = await service.change(req.actor, req.params.id, 'resolve', req.body);
  res.status(200).json({ data });
}
export async function reopen(req, res) {
  const data = await service.change(req.actor, req.params.id, 'reopen', req.body);
  res.status(200).json({ data });
}
export async function close(req, res) {
  const data = await service.change(req.actor, req.params.id, 'close', req.body);
  res.status(200).json({ data });
}
