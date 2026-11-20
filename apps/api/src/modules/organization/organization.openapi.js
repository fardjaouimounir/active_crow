import { z } from 'zod';
import * as structure from './structure.validators.js';
import * as users from './userManagement.validators.js';

const ids = z.strictObject({ id: z.uuid() });
const lookupId = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(32767)),
});
const date = z.strictObject({ at: z.iso.date().optional() });
const base = '/api/v1';
const grants = {
  reference: 'reference.read',
  users: 'org.user.read',
  manage: 'org.user.manage',
  transfer: 'org.transfer',
  readStructure: 'org.pos.read',
  structure: 'org.structure.manage',
};

const operation = (
  method,
  path,
  summary,
  permission,
  { params, query, body, status = 200, list = false, password = false } = {},
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
  password,
});

const paths = [
  operation('get', '/reference/wilayas', 'List wilayas', grants.reference),
  operation(
    'get',
    '/reference/wilayas/{id}/communes',
    'List communes in a wilaya',
    grants.reference,
    { params: lookupId },
  ),
  operation('get', '/users', 'List scoped users', grants.users, {
    query: users.userListQuery,
    list: true,
  }),
  operation('get', '/users/{id}', 'Read a scoped user and reporting history', grants.users, {
    params: ids,
  }),
  operation('get', '/users/{id}/reporting-lines', 'Read reporting history', grants.users, {
    params: ids,
  }),
  operation('post', '/users', 'Create a staff account', grants.manage, {
    body: users.createUser,
    status: 201,
    password: true,
  }),
  operation('patch', '/users/{id}', 'Update a staff profile', grants.manage, {
    params: ids,
    body: users.updateUser,
  }),
  ...['suspend', 'reactivate', 'mark-left', 'reset-password'].map((action) =>
    operation('post', '/users/{id}/' + action, action.replaceAll('-', ' '), grants.manage, {
      params: ids,
      password: action === 'reset-password',
    }),
  ),
  operation('post', '/users/{id}/transfers', 'Transfer a user', grants.transfer, {
    params: ids,
    body: users.transferBody,
    status: 201,
  }),
  operation('post', '/users/{id}/transfers/team', 'Transfer a team atomically', grants.transfer, {
    params: ids,
    body: users.transferBody,
    status: 201,
  }),
  operation(
    'delete',
    '/users/{id}/transfers/scheduled',
    'Cancel a scheduled transfer',
    grants.transfer,
    { params: ids, status: 204 },
  ),
  operation('get', '/organization/tree', 'Read the organization at a business date', grants.users, {
    query: date,
  }),
  operation('get', '/regions', 'List regions with their wilayas', grants.readStructure),
  operation('post', '/regions', 'Create a region', grants.structure, {
    body: structure.region,
    status: 201,
  }),
  operation('patch', '/regions/{id}', 'Edit a region', grants.structure, {
    params: ids,
    body: structure.regionPatch,
  }),
  operation('delete', '/regions/{id}', 'Soft-delete an empty region', grants.structure, {
    params: ids,
    status: 204,
  }),
  operation('put', '/regions/{id}/wilayas', 'Replace the wilayas of a region', grants.structure, {
    params: ids,
    body: structure.wilayas,
  }),
  operation('get', '/points-of-sale', 'List points of sale', grants.readStructure, {
    query: structure.points,
    list: true,
  }),
  operation('get', '/points-of-sale/{id}', 'Read a point of sale', grants.readStructure, {
    params: ids,
  }),
  operation('post', '/points-of-sale', 'Create a point of sale', grants.structure, {
    body: structure.createPoint,
    status: 201,
  }),
  operation(
    'patch',
    '/points-of-sale/{id}',
    'Update a point of sale at a specific version',
    grants.structure,
    { params: ids, body: structure.updatePoint },
  ),
  operation(
    'delete',
    '/points-of-sale/{id}',
    'Soft-delete an unused point of sale',
    grants.structure,
    { params: ids, status: 204 },
  ),
];

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

function response({ list, password, status, path, method }) {
  if (status === 204) return { description: 'No content' };
  let data = {};
  if (
    list ||
    (path === '/regions' && method === 'get') ||
    path.startsWith('/reference/') ||
    path === '/organization/tree' ||
    path.endsWith('/reporting-lines') ||
    path.endsWith('/team')
  ) {
    data = { type: 'array', items: { type: 'object' } };
  }
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
  if (method !== 'get') Object.assign(errors, { 409: 'Conflict', 422: 'Business rule violation' });
  for (const [code, description] of Object.entries(errors)) {
    responses[code] = { description, content: jsonContent({ $ref: '#/components/schemas/Error' }) };
  }
  return {
    summary,
    'x-permission': permission,
    security: [{ bearerAuth: [] }],
    parameters: [...parameters('path', params), ...parameters('query', query)],
    ...(body ? { requestBody: { required: true, content: jsonContent(inputSchema(body)) } } : {}),
    responses,
  };
}

export function organizationOpenApi() {
  const pathsByMethod = {};
  for (const definition of paths) {
    const path = base + definition.path;
    pathsByMethod[path] ??= {};
    pathsByMethod[path][definition.method] = operationDocument(definition);
  }
  return {
    openapi: '3.1.0',
    info: { title: 'FieldFlow Organization API', version: '0.1.0' },
    paths: pathsByMethod,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
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
}
