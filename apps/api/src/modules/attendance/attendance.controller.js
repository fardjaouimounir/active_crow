import { sendIdempotent } from '../../core/http/idempotency.js';
import * as service from './attendance.service.js';
import * as visits from './visits.service.js';

const respond = (fn) => async (req, res) => res.json({ data: await fn(req) });
const create = (fn) => async (req, res) => sendIdempotent(res, await fn(req));

export const record = create(service.recordCheckpoint);
export const absence = create(service.recordAbsence);
export const voidAbsence = respond((req) =>
  service.voidAbsence(req.actor, req.params.id, req.body.reason),
);
export const verify = respond((req) => service.review(req.actor, req.params.id, 'verified'));
export const reject = respond((req) =>
  service.review(req.actor, req.params.id, 'rejected', req.body.reason),
);
export const override = respond((req) =>
  service.review(req.actor, req.params.id, req.body.status, req.body.note, { override: true }),
);
export const bulk = respond((req) => service.verifyBulk(req.actor, req.params.id, req.body.ids));
export const board = respond((req) => service.board(req.actor, req.params.id, req.query.date));
function paged(fn) {
  return async (req, res) => {
    const { page, pageSize, sort, ...filters } = req.query;
    const rows = await fn(req.actor, req.params.id, filters);
    if (!sort.startsWith('-')) rows.reverse();
    const start = (page - 1) * pageSize;
    res.json({
      data: rows.slice(start, start + pageSize),
      meta: { page, pageSize, total: rows.length },
    });
  };
}
export const list = paged(service.recordList);
export const detail = respond((req) => service.detail(req.actor, req.params.id));
export const today = respond((req) => service.todayOverview(req.actor));
export const overview = respond((req) => service.todayOverview(req.actor, true));
export const createVisit = create(visits.createVisit);
export const listVisits = paged(visits.listVisits);
export const visitDetail = respond((req) => visits.visitDetail(req.actor, req.params.id));
export const visitOptions = respond((req) => visits.visitOptions(req.actor, req.params.id));
