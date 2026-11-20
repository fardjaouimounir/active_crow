import { drawInput, winnerDeliveredInput, winnerUnreachableInput } from '@fieldflow/shared';
import { operation } from '../../core/http/openapi.js';
import { drawParams, winnerParams, winnersQuery } from './draw.routes.js';

export function registerDrawOpenApi(registry) {
  const add = (method, path, summary, permission, options) =>
    registry.register(operation(method, path, summary, permission, options));
  add('get', '/tombolas/{id}', 'Read a Tombola with its commitment and draw', 'tombola.read', {
    params: drawParams,
  });
  add('get', '/tombolas/{id}/draw/verification', 'Data to recompute a draw', 'tombola.read', {
    params: drawParams,
  });
  add('post', '/tombolas/{id}/draw', 'Draw the Tombola (once)', 'tombola.draw', {
    params: drawParams,
    body: drawInput,
    status: 201,
  });
  add('get', '/tombolas/{id}/winners', 'List winners and reserves', 'tombola.read', {
    params: drawParams,
    query: winnersQuery,
  });
  add(
    'post',
    '/tombolas/{id}/winners/{winnerId}/unreachable',
    'Mark a winner unreachable and promote a reserve',
    'tombola.deliver',
    { params: winnerParams, body: winnerUnreachableInput },
  );
  add(
    'post',
    '/tombolas/{id}/winners/{winnerId}/delivered',
    'Mark a prize delivered',
    'tombola.deliver',
    { params: winnerParams, body: winnerDeliveredInput },
  );
}
