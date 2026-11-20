import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { messages } from './messages.js';
import { useReportExport } from './api.js';

export function useReportingText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const rtl = language.startsWith('ar');
  const locale = rtl ? 'ar-DZ-u-nu-latn' : 'en-GB';
  const num = (value, percent = false) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(
          locale,
          percent
            ? {
                style: 'percent',
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }
            : undefined,
        ).format(value);
  return { rtl, language, num, t: (key) => messages[key]?.[rtl ? 1 : 0] ?? key };
}

const indicators = [
  ['attendance', 'attendance', 'rate', true],
  ['sales', 'sales', 'units'],
  ['buyers', 'customers', 'buyers'],
  ['conversion', 'customers', 'conversionRate', true],
  ['gifts', 'gifts', 'distributionRate', true],
  ['visits', 'visits', 'count'],
  ['completion', 'completion', 'rate', true],
  ['target', 'completion', 'targetAchievement', true],
];
const statuses = [
  'verified',
  'pending',
  'rejected',
  'notSent',
  'absentJustified',
  'absentUnjustified',
];
const colors = ['#147a59', '#986311', '#ae2b39', '#526174', '#325a99', '#775a96'];

export function Cards({ values, supervisor = false }) {
  const { t, num } = useReportingText();
  const cards = supervisor
    ? [
        ['sales', 'sales', 'units'],
        indicators.at(-1),
        ...statuses.map((status) => [status, 'attendance', status]),
      ]
    : indicators;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(([title, group, field, percent]) => (
        <div key={title} className="rounded-xl border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">{t(title)}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">
            {num(values[group]?.[field], percent)}
          </dd>
          {values.previous && !supervisor && (
            <dd className="mt-1 text-xs text-slate-600">
              {t('previous')} {num(values.previous[group]?.[field], percent)}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export function ReportTable({ rows, title, columns }) {
  const { t } = useReportingText();
  return (
    <section className="report-section space-y-2">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-100">
              <tr>
                {columns.map(([key]) => (
                  <th key={key} scope="col" className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? index} className="border-t border-slate-200">
                  {columns.map(([key, render]) => (
                    <td key={key} className="p-2">
                      {render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('empty')}</p>
      )}
    </section>
  );
}

export function BreakdownTable({ rows, title }) {
  const { t, num, rtl } = useReportingText();
  return (
    <ReportTable
      rows={rows}
      title={t(title)}
      columns={[
        ['label', (row) => (rtl && row.labelAr) || row.label || row.id || '—'],
        ['sales', (row) => num(row.sales.units)],
        ['attendance', (row) => num(row.attendance.rate, true)],
        ['buyers', (row) => num(row.customers.buyers)],
        ['visits', (row) => num(row.visits.count)],
      ]}
    />
  );
}

export function DailyChart({ rows, attendance = false }) {
  const { t, num, rtl } = useReportingText();
  const keys = attendance ? statuses : ['sales'];
  const data = rows.map((row) => ({ id: row.id, sales: row.sales.units, ...row.attendance }));
  const Chart = attendance ? BarChart : LineChart;
  const title = t(attendance ? 'dailyAttendance' : 'dailySales');
  return (
    <section className="report-section min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {data.length ? (
        <>
          <div role="img" aria-label={title} className="report-chart mt-3 h-64" dir="ltr">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 320, height: 256 }}
            >
              <Chart data={data} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="id" reversed={rtl} tickFormatter={(value) => value.slice(5)} />
                <YAxis
                  orientation={rtl ? 'right' : 'left'}
                  allowDecimals={false}
                  tickFormatter={(value) => num(value)}
                />
                <Legend />
                {attendance ? (
                  keys.map((key, index) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={t(key)}
                      stackId="attendance"
                      fill={colors[index]}
                      stroke="#fff"
                      strokeDasharray={index % 2 ? '3 2' : undefined}
                      isAnimationActive={false}
                    />
                  ))
                ) : (
                  <Line
                    dataKey="sales"
                    name={t('sales')}
                    stroke={colors[0]}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                )}
              </Chart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer">{t('viewData')}</summary>
            <ReportTable
              rows={data}
              columns={[
                ['label', (row) => row.id],
                ...keys.map((key) => [key, (row) => num(row[key])]),
              ]}
            />
          </details>
        </>
      ) : (
        <p>{t('empty')}</p>
      )}
    </section>
  );
}

export function ExportButton({ id, filters }) {
  const { t, language } = useReportingText();
  const download = useReportExport(language);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={download.isPending}
        className="min-h-10 rounded-md bg-slate-900 px-4 text-white disabled:opacity-50"
        onClick={() => download.mutate({ id, filters })}
      >
        {t('export')}
      </button>
      {download.isError && (
        <p role="alert">
          {t(download.error.code === 'EXPORT_TOO_LARGE' ? 'exportTooLarge' : 'error')}
        </p>
      )}
    </div>
  );
}
