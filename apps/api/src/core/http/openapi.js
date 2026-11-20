import { z } from 'zod';
import { API_PREFIX, APP_VERSION, REFRESH_COOKIE_NAME } from '../../config/constants.js';

export const operation = (
  method,
  path,
  summary,
  permission,
  {
    params,
    query,
    body,
    status = 200,
    list = false,
    array = false,
    dataSchema,
    password = false,
    publicRoute = false,
    cookie = false,
  } = {},
) => ({
  method,
  path,
  summary,
  permission,
  params,
  query,
  body,
  status,
  list,
  array,
  dataSchema,
  password,
  publicRoute,
  cookie,
});

function inputSchema(schema) {
  const input = z.toJSONSchema(schema, { io: 'input' });
  delete input.$schema;
  return input;
}

function parameters(inLocation, schema) {
  if (!schema) return [];
  const { properties, required } = inputSchema(schema);
  return Object.entries(properties).map(([name, property]) => ({
    in: inLocation,
    name,
    required: inLocation === 'path' || (required ?? []).includes(name),
    schema: property,
  }));
}

const jsonContent = (schema) => ({ 'application/json': { schema } });
const page = {
  type: 'object',
  required: ['page', 'pageSize', 'total'],
  properties: {
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    total: { type: 'integer' },
  },
};

function response({ list, array, dataSchema, password, status }) {
  if (status === 204) return { description: 'No content' };
  let data =
    list || array ? { type: 'array', items: dataSchema ?? { type: 'object' } } : (dataSchema ?? {});
  if (password) {
    data = {
      type: 'object',
      required: ['temporaryPassword'],
      properties: {
        user: { type: 'object' },
        temporaryPassword: { type: 'string', minLength: 16, maxLength: 16 },
      },
    };
  }
  return {
    description: password
      ? 'Success. Copy the one-time temporary password from this response.'
      : 'Success',
    content: jsonContent({
      type: 'object',
      required: list ? ['data', 'meta'] : ['data'],
      properties: list ? { data, meta: page } : { data },
    }),
  };
}

function operationDocument(config) {
  const { method, summary, permission, params, query, body, status } = config;
  const responses = { [status]: response(config) };
  const errors = {
    400: 'Invalid input',
    401: 'Unauthenticated',
    403: 'Forbidden',
    404: 'Resource missing or outside scope',
  };
  if (method !== 'get')
    Object.assign(errors, { 409: 'Conflict', 422: 'Business rule violation', 429: 'Rate limited' });
  for (const [code, description] of Object.entries(errors)) {
    responses[code] = { description, content: jsonContent({ $ref: '#/components/schemas/Error' }) };
  }
  return {
    summary,
    'x-permission': permission,
    security: config.cookie
      ? [{ refreshCookie: [] }]
      : config.publicRoute
        ? []
        : [{ bearerAuth: [] }],
    parameters: [...parameters('path', params), ...parameters('query', query)],
    ...(body ? { requestBody: { required: true, content: jsonContent(inputSchema(body)) } } : {}),
    responses,
  };
}

export function createOpenApiRegistry() {
  const paths = {};
  return {
    register(definition) {
      const path = API_PREFIX + definition.path;
      paths[path] ??= {};
      if (paths[path][definition.method])
        throw new Error('Duplicate OpenAPI operation: ' + definition.method + ' ' + path);
      paths[path][definition.method] = operationDocument(definition);
    },
    document() {
      return {
        openapi: '3.1.0',
        info: { title: 'FieldFlow API', version: APP_VERSION },
        paths: structuredClone(paths),
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            refreshCookie: { type: 'apiKey', in: 'cookie', name: REFRESH_COOKIE_NAME },
          },
          schemas: {
            Error: {
              type: 'object',
              required: ['error'],
              properties: {
                error: {
                  type: 'object',
                  required: ['code', 'message', 'requestId'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    requestId: { type: 'string' },
                    details: {},
                  },
                },
              },
            },
          },
        },
      };
    },
  };
}
