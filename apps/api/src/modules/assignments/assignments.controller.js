import { assignmentService as service } from './assignments.service.js';

const respond =
  (fn, status = 200) =>
  async (req, res) => {
    res.status(status).json({ data: await fn(req) });
  };
export async function list(req, res) {
  res.json(await service.list(req.actor, req.params.id, req.query));
}
export async function pending(req, res) {
  res.json(await service.pending(req.actor, req.query));
}
export const propose = respond((req) => service.propose(req.actor, req.params.id, [req.body]), 201);
export const batch = respond(
  (req) => service.propose(req.actor, req.params.id, req.body, true),
  201,
);
export const candidates = respond((req) => service.candidates(req.actor, req.params.id, req.query));
export const staffing = respond((req) =>
  service.staffing(req.actor, req.params.id, req.query.date),
);
export const mine = respond((req) => service.mine(req.actor));
export const decisions = respond((req) => service.decide(req.actor, req.body, true));
export const approve = respond((req) =>
  service.decide(req.actor, [{ id: req.params.id, decision: 'approve', ...req.body }]),
);
export const reject = respond((req) =>
  service.decide(req.actor, [{ id: req.params.id, decision: 'reject', ...req.body }]),
);
export const cancel = respond((req) =>
  service.mutate(req.actor, req.params.id, 'cancel', req.body),
);
export const end = respond((req) => service.mutate(req.actor, req.params.id, 'end', req.body));
export const replace = respond(
  (req) => service.mutate(req.actor, req.params.id, 'replace', req.body),
  201,
);
