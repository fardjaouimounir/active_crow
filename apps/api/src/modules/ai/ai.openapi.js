import { operation } from '../../core/http/openapi.js';
import * as input from './ai.validators.js';

export function registerAiOpenApi(registry) {
  const add = (method, path, summary, permission, options) =>
    registry.register(operation(method, path, summary, permission, options));
  add('post', '/ai/requests', 'Request an AI suggestion', 'ai.request', {
    body: input.aiRequestInput,
    status: 201,
  });
  add('get', '/ai/requests', 'List AI requests', 'ai.request', {
    query: input.aiRequestFilters,
    list: true,
  });
  add('get', '/ai/commentary', 'Latest accepted AI commentary', 'reports.read', {
    query: input.commentaryQuery,
  });
  add('get', '/ai/suggestions', 'List AI suggestions', 'ai.review', {
    query: input.aiSuggestionFilters,
    list: true,
  });
  add('get', '/ai/suggestions/{id}', 'Read an AI suggestion', 'ai.review', {
    params: input.params,
  });
  add('post', '/ai/suggestions/{id}/accept', 'Accept an AI suggestion', 'ai.review', {
    params: input.params,
    body: input.aiAcceptInput,
  });
  add('post', '/ai/suggestions/{id}/reject', 'Reject an AI suggestion', 'ai.review', {
    params: input.params,
    body: input.aiRejectInput,
  });
  add('post', '/internal/ai/results', 'AI service callback (service key)', 'service', {
    body: input.aiCallbackSchema,
    service: true,
  });
}
