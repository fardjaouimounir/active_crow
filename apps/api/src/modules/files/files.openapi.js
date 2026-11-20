import { fileVisibilityBodySchema, IMAGE_MIME_TYPES } from '@fieldflow/shared';
import { operation } from '../../core/http/openapi.js';
import { fileParams } from './files.routes.js';

const POLICY = 'delegated: policy of the file kind (unknown kind or denied ⇒ 404)';

const paths = [
  operation('get', '/files/{id}', 'Stream a file inline', POLICY, {
    params: fileParams,
    binary: ['application/pdf', ...IMAGE_MIME_TYPES],
  }),
  operation(
    'get',
    '/files/{id}/thumbnail',
    'Stream the 400 px WebP thumbnail of an image',
    POLICY,
    {
      params: fileParams,
      binary: ['image/webp'],
    },
  ),
  operation(
    'patch',
    '/files/{id}/visibility',
    'Share a campaign document or visit photo with the client, or make it internal again',
    'file.share_with_client',
    { params: fileParams, body: fileVisibilityBodySchema },
  ),
];

export function registerFilesOpenApi(registry) {
  paths.forEach((path) => registry.register(path));
}
