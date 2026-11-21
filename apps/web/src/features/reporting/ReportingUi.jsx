import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { KpiStrip, KpiTile, TableFrame, tableClass } from '../../ui/data.jsx';
import { buttonClass } from '../../ui/primitives.jsx';
import {
  chartAxis,
  chartGrid,
  chartLegend,
  chartSeries,
  chartTooltip,
} from '../../ui/chartTheme.js';
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
  const t = (key, values = {}) =>
    (messages[key]?.[rtl ? 1 : 0] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  return { rtl, language, num, t };
}

/** Attendance status → series color: good = spring family, problems stay distinguishable. */
const STATUS_COLORS = {
  verified: chartSeries[0],
  pending: chartSeries[1],
  rejected: 'var(--danger-solid)',
  notSent: chartSeries[3],
  absentJustified: chartSeries[4],
  absentUnjustified: chartSeries[5],
};

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

/** Cards where an increase is bad news. */
const REGRESSIONS = new Set(['rejected', 'notSent', 'absentUnjustified']);

/** What a client may see: no attendance, no visits (staff work), only results. */
const CLIENT_CARDS = new Set(['sales', 'buyers', 'conversion', 'gifts', 'completion', 'target']);

export function Cards({ values, supervisor = false, view = 'staff' }) {
  const { t, num } = useReportingText();
  const cards = supervisor
    ? [
        ['sales', 'sales', 'units'],
        indicators.at(-1),
        ...statuses.map((status) => [status, 'attendance', status]),
      ]
    : view === 'client'
      ? indicators.filter(([title]) => CLIENT_CARDS.has(title))
      : indicators;
  return (
    <KpiStrip>
      {cards.map(([title, group, field, percent]) => {
        const value = values[group]?.[field];
        const previous = values.previous && !supervisor ? values.previous[group]?.[field] : null;
        return (
          <KpiTile
            key={title}
            label={t(title)}
            value={value ?? null}
            format={(number) => num(number, percent)}
            delta={previous != null && value != null ? value - previous : null}
            deltaFormat={(number) => num(number, percent)}
            deltaGood={!REGRESSIONS.has(title)}
            period={previous != null ? `${t('previous')} ${num(previous, percent)}` : undefined}
          />
        );
      })}
    </KpiStrip>
  );
}

/** Columns are [translationKey, render, numeric?]; numeric columns are right-aligned tabular figures. */
export function ReportTable({ rows, title, columns }) {
  const { t } = useReportingText();
  return (
    <section className="report-section space-y-2">
      {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
      {rows.length ? (
        <TableFrame>
          <div className="overflow-x-auto">
            <table className={tableClass.table}>
              <thead className={tableClass.head}>
                <tr>
                  {columns.map(([key, , numeric]) => (
                    <th key={key} scope="col" className={tableClass.th(true, numeric)}>
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? index} className={tableClass.row()}>
                    {columns.map(([key, render, numeric]) => (
                      <td key={key} className={tableClass.td(true, numeric)}>
                        {render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableFrame>
      ) : (
        <p className="text-sm text-fg-2">{t('empty')}</p>
      )}
    </section>
  );
}

export function BreakdownTable({ rows, title, view = 'staff', ranked = false }) {
  const { t, num, rtl } = useReportingText();
  return (
    <ReportTable
      rows={rows}
      title={t(title)}
      columns={[
        ...(ranked ? [['rank', (row) => num(row.rank), true]] : []),
        ['label', (row) => (rtl && row.labelAr) || row.label || row.id || '—'],
        ['sales', (row) => num(row.sales.units), true],
        ...(view === 'client'
          ? []
          : [['attendance', (row) => num(row.attendance.rate, true), true]]),
        ['buyers', (row) => num(row.customers.buyers), true],
        ...(view === 'client' ? [] : [['visits', (row) => num(row.visits.count), true]]),
      ]}
    />
  );
}

export function DailyChart({ rows, attendance = false }) {
  const { t, num, rtl } = useReportingText();
  const keys = attendance ? statuses : ['sales'];
  const data = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({ id: row.id, sales: row.sales.units, ...row.attendance }));
  const Chart = attendance ? BarChart : LineChart;
  const title = t(attendance ? 'dailyAttendance' : 'dailySales');
  return (
    <section className="report-section min-w-0 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold tracking-tight">{title}</h2>
      {data.length ? (
        <>
          <div role="img" aria-label={title} className="report-chart mt-3 h-64" dir="ltr">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 320, height: 256 }}
            >
              <Chart data={data} accessibilityLayer>
                <CartesianGrid {...chartGrid} />
                <XAxis
                  {...chartAxis}
                  dataKey="id"
                  interval="preserveStartEnd"
                  padding={{ left: 24, right: 24 }}
                  tickFormatter={(value) => value.slice(5)}
                />
                <YAxis
                  {...chartAxis}
                  orientation={rtl ? 'right' : 'left'}
                  allowDecimals={false}
                  tickFormatter={(value) => num(value)}
                />
                <Tooltip {...chartTooltip} formatter={(value) => num(value)} />
                <Legend {...chartLegend} />
                {attendance ? (
                  keys.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={t(key)}
                      stackId="attendance"
                      fill={STATUS_COLORS[key]}
                      stroke="var(--surface)"
                      isAnimationActive={false}
                    />
                  ))
                ) : (
                  <Line
                    dataKey="sales"
                    name={t('sales')}
                    stroke={chartSeries[0]}
                    strokeWidth={2}
                    dot={false}
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
        className={buttonClass({ variant: 'primary' })}
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
