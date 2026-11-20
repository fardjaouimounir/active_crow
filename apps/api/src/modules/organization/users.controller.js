import { ScopeService } from '../../core/authz/index.js';
import { transfersService } from './transfers.service.js';
import { userManagementService } from './userManagement.service.js';
import { usersService } from './users.service.js';

export async function list(req, res) {
  res.json(await usersService.list(ScopeService.forRequest(req), req.query));
}

export async function transfer(req, res) {
  const data = await transfersService.create(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
    req.body,
  );
  res.status(201).json({ data });
}

export async function transferTeam(req, res) {
  const data = await transfersService.create(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
    req.body,
    true,
  );
  res.status(201).json({ data });
}

export async function cancelTransfer(req, res) {
  await transfersService.cancel(ScopeService.forRequest(req), req.actor, req.params.id);
  res.status(204).end();
}

export async function detail(req, res) {
  res.json({
    data: await userManagementService.detail(ScopeService.forRequest(req), req.params.id),
  });
}

export async function reportingLines(req, res) {
  const { reportingLines } = await userManagementService.detail(
    ScopeService.forRequest(req),
    req.params.id,
  );
  res.json({ data: reportingLines });
}

export async function create(req, res) {
  const data = await userManagementService.create(
    ScopeService.forRequest(req),
    req.actor,
    req.body,
  );
  res.set('Cache-Control', 'no-store').status(201).json({ data });
}

export async function update(req, res) {
  const data = await userManagementService.update(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
    req.body,
  );
  res.json({ data });
}

export const changeStatus = (status) => async (req, res) => {
  const data = await userManagementService.changeStatus(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
    status,
  );
  res.json({ data });
};

export async function resetPassword(req, res) {
  const data = await userManagementService.resetPassword(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
  );
  res.set('Cache-Control', 'no-store').json({ data });
}
