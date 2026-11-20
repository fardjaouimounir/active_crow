import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './ai.controller.js';
import * as input from './ai.validators.js';

/** User-facing AI routes, all under `/ai`. */
export function createAiRouter() {
  const router = Router();
  const route = (method, path, permission, schemas, handler) =>
    router[method](
      path,
      authenticate,
      requirePermission(permission),
      validate({
        params: path.includes(':id') ? input.params : input.empty,
        query: input.empty,
        body: input.empty,
        ...schemas,
      }),
      handler,
    );
  route('post', '/requests', 'ai.request', { body: input.aiRequestInput }, controller.request);
  route(
    'get',
    '/requests',
    'ai.request',
    { query: input.aiRequestFilters },
    controller.listRequests,
  );
  route(
    'get',
    '/commentary',
    'reports.read',
    { query: input.commentaryQuery },
    controller.commentary,
  );
  route(
    'get',
    '/suggestions',
    'ai.review',
    { query: input.aiSuggestionFilters },
    controller.listSuggestions,
  );
  route('get', '/suggestions/:id', 'ai.review', {}, controller.getSuggestion);
  route(
    'post',
    '/suggestions/:id/accept',
    'ai.review',
    { body: input.aiAcceptInput },
    controller.accept,
  );
  route(
    'post',
    '/suggestions/:id/reject',
    'ai.review',
    { body: input.aiRejectInput },
    controller.reject,
  );
  return router;
}
