import { useCampaignResource, useCampaignWrite } from '../campaigns/api.js';

export const assignmentPath = (campaignId) => '/campaigns/' + campaignId;
export const useAssignments = (id, filters) =>
  useCampaignResource(assignmentPath(id) + '/assignments', filters, { keepPrevious: true });
export const useStaffing = (id, date) =>
  useCampaignResource(assignmentPath(id) + '/staffing', { date });
export const usePendingAssignments = (page, enabled) =>
  useCampaignResource('/assignments/pending', { page }, { enabled, keepPrevious: true });
export const useAssignmentWrite = useCampaignWrite;

export function useCandidateOptions(id, filters, t) {
  const enabled = Boolean(
    filters.wilayaId && filters.from && filters.to && filters.from <= filters.to,
  );
  const query = useCampaignResource(assignmentPath(id) + '/assignment-candidates', filters, {
    enabled,
  });
  return {
    options: (query.data?.data ?? []).map(({ id, fullName, available, conflict }) => ({
      value: id,
      disabled: !available,
      label: available
        ? fullName
        : fullName +
          ' — ' +
          t('assignments.unavailable', { from: conflict.startDate, to: conflict.endDate }),
    })),
    pending: enabled && query.isPending,
    error: query.error,
  };
}
