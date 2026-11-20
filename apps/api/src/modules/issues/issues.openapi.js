import * as schema from '@fieldflow/shared';
import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';
const params = z.strictObject({ id: z.uuid() });
export function registerIssuesOpenApi(registry) {
  registry.register(
    operation('get', '/issues', 'List issues', 'issue.read', {
      query: schema.issueFilters,
      list: true,
    }),
  );
  registry.register(
    operation('post', '/issues', 'Create issues', 'issue.create', {
      body: schema.issueCreate,
      status: 201,
      idempotent: 'optional',
      multipart: { fields: schema.issueCreate, multiple: true },
    }),
  );
  registry.register(operation('get', '/issues/{id}', 'Detail issues', 'issue.read', { params }));
  registry.register(
    operation('get', '/issues/{id}/comments', 'Comments issues', 'issue.read', {
      params,
      array: true,
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/comments', 'Comment issues', 'issue.read', {
      params,
      body: schema.issueComment,
      status: 201,
      multipart: { fields: schema.issueComment, multiple: true },
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/assign', 'Assign issues', 'issue.manage', {
      params,
      body: schema.issueAssign,
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/start', 'Start issues', 'issue.manage', {
      params,
      body: schema.issueChange,
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/resolve', 'Resolve issues', 'issue.manage', {
      params,
      body: schema.issueChange,
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/reopen', 'Reopen issues', 'issue.read', {
      params,
      body: schema.issueChange,
    }),
  );
  registry.register(
    operation('post', '/issues/{id}/close', 'Close issues', 'issue.manage', {
      params,
      body: schema.issueChange,
    }),
  );
}
