import * as schema from '@fieldflow/shared';
import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';

const params = z.strictObject({ id: z.uuid() });
export function registerAssignmentsOpenApi(registry) {
  registry.register(
    operation('get', '/campaigns/{id}/assignments', 'List assignments', 'assignment.read', {
      params,
      query: schema.assignmentFilters,
      list: true,
    }),
  );
  registry.register(
    operation('post', '/campaigns/{id}/assignments', 'Propose assignments', 'assignment.propose', {
      params,
      body: schema.assignmentProposal,
      status: 201,
    }),
  );
  registry.register(
    operation(
      'post',
      '/campaigns/{id}/assignments/batch',
      'Batch assignments',
      'assignment.propose',
      { params, body: schema.assignmentProposals, status: 201, array: true },
    ),
  );
  registry.register(
    operation(
      'get',
      '/campaigns/{id}/assignment-candidates',
      'Candidates assignments',
      'assignment.propose',
      { params, query: schema.assignmentCandidates, array: true },
    ),
  );
  registry.register(
    operation('get', '/campaigns/{id}/staffing', 'Staffing assignments', 'assignment.read', {
      params,
      query: schema.staffingDate,
      array: true,
    }),
  );
  registry.register(
    operation('get', '/assignments/pending', 'Pending assignments', 'assignment.approve', {
      query: schema.assignmentPaging,
      list: true,
    }),
  );
  registry.register(
    operation('post', '/assignments/decisions', 'Decisions assignments', 'assignment.approve', {
      body: schema.assignmentDecisions,
      array: true,
    }),
  );
  registry.register(
    operation('post', '/assignments/{id}/approve', 'Approve assignments', 'assignment.approve', {
      params,
      body: schema.assignmentDecision,
      status: 200,
    }),
  );
  registry.register(
    operation('post', '/assignments/{id}/reject', 'Reject assignments', 'assignment.approve', {
      params,
      body: schema.assignmentDecision,
      status: 200,
    }),
  );
  registry.register(
    operation(
      'post',
      '/assignments/{id}/cancel',
      'Cancel assignments',
      ['assignment.propose', 'assignment.approve'],
      { params, body: schema.assignmentDecision, status: 200 },
    ),
  );
  registry.register(
    operation('post', '/assignments/{id}/end', 'End assignments', 'assignment.approve', {
      params,
      body: schema.assignmentEnd,
      status: 200,
    }),
  );
  registry.register(
    operation(
      'post',
      '/assignments/{id}/replace',
      'Replace assignments',
      ['assignment.propose', 'assignment.approve'],
      { params, body: schema.assignmentReplacement, status: 201 },
    ),
  );
  registry.register(
    operation('get', '/me/assignments', 'Mine assignments', 'assignment.read', { array: true }),
  );
}
