import {
  activePoints,
  countRows,
  hasApprovedAssignmentOnDay,
  liveStatuses,
} from './assignments.repository.js';

const countActiveForSupervisor = (tx, campaignId, userId) =>
  countRows(tx, { campaignId, supervisorId: userId, status: { in: liveStatuses } });
const countActiveForAnimateur = (tx, campaignId, userId) =>
  countRows(tx, { campaignId, animateurId: userId, status: { in: liveStatuses } });
const countApproved = (tx, campaignId) => countRows(tx, { campaignId, status: 'approved' });

export const assignmentReadService = Object.freeze({
  countApproved,
  hasApprovedAssignmentOnDay,
  countActiveForSupervisor,
  countActiveForAnimateur,
  pointsOfSaleWithActiveAssignments: activePoints,
});
