import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { QueryState } from './AttendanceTab.jsx';
import { useReviewOverview } from './api.js';

export function ReviewPage() {
  const { t } = useTranslation('common');
  const allowed = useCan('attendance.review');
  const query = useReviewOverview(allowed);
  if (!allowed) return <p role="alert">{t('errors.FORBIDDEN')}</p>;
  const daily = query.data?.data;
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('admin.attendance')}</h1>
      <QueryState query={query} />
      {daily &&
        (daily.campaigns.length ? (
          <ul className="grid gap-3">
            {daily.campaigns.map((item) => (
              <li key={item.campaignId} className="rounded border border-line p-3">
                <Link
                  className="font-semibold underline"
                  to={`/app/campaigns/${item.campaignId}?tab=attendance&date=${daily.date}`}
                >
                  {item.campaignName}
                </Link>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(item.counters).map(([status, count]) => (
                    <span key={status}>
                      {t(
                        status === 'late' ? 'attendance.flags.late' : 'attendance.status.' + status,
                      )}{' '}
                      {count}
                    </span>
                  ))}
                </div>
                <ul>
                  {item.pending.map((row) => (
                    <li key={row.id}>
                      {row.animateur?.fullName} {row.checkpoint}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('attendance.empty')}</p>
        ))}
    </section>
  );
}
