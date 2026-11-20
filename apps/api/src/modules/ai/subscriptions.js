import { subscribe } from '../notifications/subscriptions.js';
import * as repository from './ai.repository.js';

// A suggestion arrived: tell the agency-level reviewers (and a regional requester).
subscribe('ai.suggestion_received', async (tx, { payload }) => {
  const reviewers = await repository.reviewerIds(tx, payload.agencyId);
  return {
    userIds: [
      ...reviewers.map(({ id }) => id),
      ...(payload.requesterId ? [payload.requesterId] : []),
    ],
    entityType: 'ai_suggestion',
    entityId: payload.suggestionId,
    payload: { capability: payload.capability },
  };
});

// Accepted or rejected: tell whoever asked for it.
subscribe('ai.suggestion_reviewed', async (_tx, { payload }) => {
  if (!payload.requesterId) return null;
  return {
    userIds: [payload.requesterId],
    entityType: 'ai_suggestion',
    entityId: payload.suggestionId,
    payload: { capability: payload.capability, decision: payload.decision },
  };
});
