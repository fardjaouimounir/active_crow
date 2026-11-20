import {
  changePasswordBodySchema,
  loginBodySchema,
  USER_ROLES,
  PERMISSIONS,
} from '@fieldflow/shared';
import { operation } from '../../core/http/openapi.js';

const user = {
  type: 'object',
  required: ['id', 'fullName', 'email', 'role', 'agencyId', 'clientId', 'mustChangePassword'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    fullName: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { enum: USER_ROLES },
    agencyId: { type: 'string', format: 'uuid' },
    clientId: { type: ['string', 'null'], format: 'uuid' },
    mustChangePassword: { type: 'boolean' },
  },
};
const session = {
  type: 'object',
  required: ['accessToken', 'expiresIn', 'user'],
  properties: { accessToken: { type: 'string' }, expiresIn: { type: 'integer' }, user },
};
const currentSession = {
  type: 'object',
  required: ['user', 'permissions'],
  properties: { user, permissions: { type: 'array', items: { enum: PERMISSIONS } } },
};

export function registerAuthOpenApi(registry) {
  [
    operation('post', '/auth/login', 'Sign in', undefined, {
      publicRoute: true,
      body: loginBodySchema,
      dataSchema: session,
    }),
    operation('post', '/auth/refresh', 'Rotate the refresh token', undefined, {
      cookie: true,
      dataSchema: session,
    }),
    operation('post', '/auth/logout', 'Sign out', undefined, { status: 204 }),
    operation('post', '/auth/logout-all', 'Revoke all sessions', undefined, { status: 204 }),
    operation('post', '/auth/change-password', 'Change password', undefined, {
      body: changePasswordBodySchema,
      dataSchema: session,
    }),
    operation('get', '/auth/me', 'Read the current session', undefined, {
      dataSchema: currentSession,
    }),
  ].forEach((path) => registry.register(path));
}
