import { ScopeService } from '../../core/authz/index.js';
import { organizationService } from './organization.service.js';

export async function tree(req, res) {
  res.json({ data: await organizationService.tree(ScopeService.forRequest(req), req.query.at) });
}
