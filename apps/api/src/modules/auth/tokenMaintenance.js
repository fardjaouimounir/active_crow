import { now } from '@fieldflow/shared';
import { withTransaction } from '../../db/transaction.js';
import { deleteExpiredRefreshTokens } from './auth.repository.js';

export function cleanupTokens() {
  return withTransaction((tx) => deleteExpiredRefreshTokens(now(), tx));
}
