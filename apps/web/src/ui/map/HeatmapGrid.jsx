import { useId, useState } from 'react';
import { CLASSES, classOf, quantileBreaks, scaleToken } from './geo.js';
import { useGeoText } from './geoMessages.js';

const CELL = 22;
const GAP = 2;
const LEFT = 44;
const TOP = 20;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Weekday x hour heatmap as an SVG grid (no chart library). Colour classes are the same quantile
 * scale as the maps; every cell has a text alternative and the whole grid has a table twin. The
 * hour axis reads chronologically left to right. Hours are Algiers time.
 */
export function HeatmapGrid({ matrix, kind, title }) {
  const { t, rtl, locale, number } = useGeoText();
  const [active, setActive] = useState(null);
  const tableId = useId();
  const values = matrix.flat();
  const breaks = quantileBreaks(values);
  const max = Math.max(0, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + index)), // 2024-01-01 is a Monday
    ),
  );
  const width = LEFT + 24 * (CELL + GAP);
  const gridStart = rtl ? 0 : LEFT; // labels take the reading-start side: right in RTL
  const height = TOP + 7 * (CELL + GAP);
  const x = (hour) => gridStart + hour * (CELL + GAP);
  const y = (day) => TOP + day * (CELL + GAP);
  const hourLabel = (hour) => String(hour).padStart(2, '0');
  if (!total)
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-fg-2">{t('emptyHeatmap')}</p>
      </section>
    );
  const label = (day, hour) =>
    `${weekdays[day]} ${hourLabel(hour)}:00 – ${number(matrix[day][hour])}`;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`${title}. ${t('total')}: ${number(total)}`}
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[36rem]"
          dir="ltr"
        >
          {HOURS.filter((hour) => hour % 3 === 0).map((hour) => (
            <text
              key={hour}
              x={x(hour) + CELL / 2}
              y={12}
              textAnchor="middle"
              className="fill-fg-3 text-[10px]"
            >
              {hourLabel(hour)}
            </text>
          ))}
          {weekdays.map((name, day) => (
            <text
              key={name}
              x={rtl ? width - LEFT + 6 : LEFT - 6}
              y={y(day) + CELL / 2 + 3}
              textAnchor={rtl ? 'start' : 'end'}
              className="fill-fg-3 text-[10px]"
            >
              {name}
            </text>
          ))}
          {matrix.map((row, day) =>
            row.map((count, hour) => (
              <rect
                key={`${day}-${hour}`}
                x={x(hour)}
                y={y(day)}
                width={CELL}
                height={CELL}
                rx="3"
                fill={`var(${scaleToken(classOf(count, breaks), CLASSES)})`}
                stroke={active === `${day}-${hour}` ? 'var(--map-select)' : 'var(--line)'}
                strokeWidth={active === `${day}-${hour}` ? 2 : 0.5}
                onMouseEnter={() => setActive(`${day}-${hour}`)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(`${day}-${hour}`)}
                onBlur={() => setActive(null)}
                aria-label={count > 0 ? label(day, hour) : undefined}
                aria-hidden={count > 0 ? undefined : true}
              >
                <title>{label(day, hour)}</title>
              </rect>
            )),
          )}
        </svg>
      </div>
      <p className="text-xs text-fg-3">
        {t('heatmapNote')} {t('total')}:{' '}
        <span className="tnum font-medium text-fg">{number(total)}</span> ·{' '}
        <span className="tnum">max {number(max)}</span>
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-2">{t('viewTable')}</summary>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table id={tableId} className="w-full border-collapse text-xs" data-kind={kind}>
            <caption className="sr-only">{title}</caption>
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className="px-2 py-1 text-start font-medium text-fg-3">
                  {t('weekday')}
                </th>
                {HOURS.map((hour) => (
                  <th
                    key={hour}
                    scope="col"
                    className="tnum px-1 py-1 text-end font-medium text-fg-3"
                  >
                    {hourLabel(hour)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, day) => (
                <tr key={weekdays[day]} className="border-t border-line">
                  <th scope="row" className="px-2 py-1 text-start font-medium">
                    {weekdays[day]}
                  </th>
                  {row.map((count, hour) => (
                    <td
                      key={hour}
                      className={'tnum px-1 py-1 text-end ' + (count ? 'text-fg' : 'text-fg-3')}
                    >
                      {number(count)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
