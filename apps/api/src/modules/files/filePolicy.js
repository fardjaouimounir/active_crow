import { ScopeService } from '../../core/authz/index.js';
import { GUARD, tagGuard } from '../../core/authz/routeGuards.js';
import { NotFoundError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { decideFileAccess } from './fileAccessPolicies.js';
import * as repository from './files.repository.js';

/**
 * Route guard for file reads (after `authenticate`): loads the agency's file and asks the policy
 * registered for its kind. A missing file, an unregistered kind and a denial are all 404, never 403.
 * @returns {import('express').RequestHandler}
 */
export function filePolicy() {
  return tagGuard(async (req, _res, next) => {
    const file = await repository.findFile(prisma, ScopeService.forRequest(req), req.params.id);
    const decision = file && (await decideFileAccess(req.actor, file, prisma));
    if (!decision) throw new NotFoundError();
    req.fileAccess = { file, filename: decision.filename };
    next();
  }, GUARD.FILE_POLICY);
}
