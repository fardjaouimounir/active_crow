/**
 * One chart theme for every recharts chart, built from tokens (see ui/tokens.css).
 * Spring is the primary series; aquamarine / lawn / neutral follow. CSS variables resolve at paint
 * time, so charts follow the light/dark theme with no re-render.
 */
export const chartSeries = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

export const chartGrid = { stroke: 'var(--chart-grid)', strokeDasharray: '2 4', vertical: false };

export const chartAxis = {
  tick: { fill: 'var(--chart-axis)', fontSize: 12 },
  axisLine: { stroke: 'var(--chart-grid)' },
  tickLine: false,
};

export const chartTooltip = {
  contentStyle: {
    background: 'var(--raised)',
    border: '1px solid var(--line-strong)',
    borderRadius: 6,
    color: 'var(--fg)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--fg-2)' },
  itemStyle: { color: 'var(--fg)' },
  cursor: { stroke: 'var(--line-strong)', fill: 'var(--sunken)' },
};

export const chartLegend = { wrapperStyle: { color: 'var(--fg-2)', fontSize: 12 } };
