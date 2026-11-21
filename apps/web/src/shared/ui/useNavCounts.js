import { useCan } from '../auth/hooks.js';
import { useCampaignResource } from '../../features/campaigns/api.js';
import { useReviewOverview } from '../../features/attendance/api.js';

const REFRESH = { staleTime: 60_000 };

/**
 * Small live counts for the sidebar (what is waiting for this user), from the same scoped list
 * endpoints the pages use: no separate counting API. Missing permission = no request, no badge.
 */
export function useNavCounts() {
  const approve = useCan('assignment.approve');
  const issues = useCan('issue.read');
  const review = useCan('attendance.review');
  const pending = useCampaignResource(
    '/assignments/pending',
    { page: 1, pageSize: 1 },
    { enabled: approve, ...REFRESH },
  );
  const open = useCampaignResource(
    '/issues',
    { status: 'open', page: 1, pageSize: 1 },
    { enabled: issues, ...REFRESH },
  );
  const attendance = useReviewOverview(review);
  const waiting = attendance.data?.data?.campaigns?.reduce(
    (sum, item) => sum + (item.counters?.pending ?? 0),
    0,
  );
  return {
    '/app/approvals': pending.data?.meta?.total ?? 0,
    '/app/issues': open.data?.meta?.total ?? 0,
    '/app/attendance': waiting ?? 0,
  };
}
