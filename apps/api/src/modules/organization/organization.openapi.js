import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';
import * as structure from './structure.validators.js';
import * as users from './userManagement.validators.js';

const ids = z.strictObject({ id: z.uuid() });
const lookupId = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(32767)),
});
const date = z.strictObject({ at: z.iso.date().optional() });

const grants = {
  reference: 'reference.read',
  users: 'org.user.read',
  manage: 'org.user.manage',
  transfer: 'org.transfer',
  readStructure: 'org.pos.read',
  structure: 'org.structure.manage',
};

const paths = [
  operation('get', '/reference/wilayas', 'List wilayas', grants.reference, { array: true }),
  operation(
    'get',
    '/reference/wilayas/{id}/communes',
    'List communes in a wilaya',
    grants.reference,
    { params: lookupId, array: true },
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
    array: true,
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
    array: true,
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
    array: true,
  }),
  operation('get', '/regions', 'List regions with their wilayas', grants.readStructure, {
    array: true,
  }),
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

export function registerOrganizationOpenApi(registry) {
  paths.forEach((path) => registry.register(path));
}
