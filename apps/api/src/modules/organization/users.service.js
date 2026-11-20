import { businessDate } from '../../core/time/clock.js';
import { countClientUsers, listUsers } from './users.repository.js';

/** @param {object} query validated list query; `clientId` narrows to one client's portal accounts */
function list(scope, query) {
  return listUsers(scope, query, new Date(businessDate()));
}

/** Portal accounts per client id, for the visible users of the scope. */
function countByClient(scope, clientIds) {
  return countClientUsers(scope, clientIds, new Date(businessDate()));
}

export const usersService = Object.freeze({ list, countByClient });
