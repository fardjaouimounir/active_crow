import { businessDate } from '../../core/time/clock.js';
import { listUsers } from './users.repository.js';

function list(scope, query) {
  return listUsers(scope, query, new Date(businessDate()));
}

export const usersService = Object.freeze({ list });
