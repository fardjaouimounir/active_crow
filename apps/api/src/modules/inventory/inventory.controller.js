import { runIdempotent, sendIdempotent } from '../../core/http/index.js';
import { fileService } from '../files/files.service.js';
import * as reports from './inventory.reports.js';
import * as service from './inventory.service.js';

/** Runs a write once per Idempotency-Key; `files` when a proof upload may be stored in it. */
const write =
  (work, { status = 200, files = false } = {}) =>
  async (req, res) => {
    const result = await runIdempotent(req, (tx) => work(tx, req), {
      status,
      transaction: files ? (fn) => fileService.transaction(fn) : undefined,
    });
    sendIdempotent(res, result);
  };

const read = (work) => async (req, res) => {
  res.json({ data: await work(req) });
};

export const stockIn = write(
  (tx, req) => service.stockIn(tx, req.actor, req.params.id, req.body, req.file?.buffer),
  { status: 201, files: true },
);
export const transfer = write(
  (tx, req) => service.transfer(tx, req.actor, req.params.id, req.body),
  { status: 201 },
);
export const giveBack = write(
  (tx, req) => service.giveBack(tx, req.actor, req.params.id, req.body),
  { status: 201 },
);
export const confirm = write((tx, req) =>
  service.confirm(tx, req.actor, req.params.movementId, req.body),
);
export const cancel = write((tx, req) => service.cancel(tx, req.actor, req.params.movementId));
export const resolve = write((tx, req) =>
  service.resolveDispute(tx, req.actor, req.params.movementId, req.body),
);
export const requestAdjustment = write(
  (tx, req) => service.requestAdjustment(tx, req.actor, req.params.id, req.body, req.file?.buffer),
  { status: 201, files: true },
);
export const decide = (decision) =>
  write((tx, req) =>
    service.decideAdjustment(tx, req.actor, req.params.movementId, decision, req.body),
  );

export const balances = read((req) => reports.balances(req.actor, req.params.id));
export const reconciliation = read((req) => reports.reconciliation(req.actor, req.params.id));
export const recipients = read((req) =>
  reports.recipients(req.actor, req.params.id, req.query.direction),
);
export const movementDetail = read((req) =>
  reports.movementDetail(req.actor, req.params.movementId),
);
export const mine = read((req) => reports.mine(req.actor));
export async function movements(req, res) {
  res.json(await reports.movements(req.actor, req.params.id, req.query));
}
