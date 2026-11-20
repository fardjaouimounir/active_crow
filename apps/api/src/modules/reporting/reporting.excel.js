import ExcelJS from 'exceljs';
import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { XLSX, definitions, metrics } from './reporting.columns.js';
import { aiService } from '../ai/ai.service.js';
import { reportingService } from './reporting.service.js';

const MAX_ROWS = 100_000;
const metricValue = (data, [, group, key]) => data[group]?.[key] ?? null;
const date = (day) => new Date(`${day}T00:00:00Z`);

export async function download(req, res, { filters, id, view }) {
  const data = await reportingService.exportData(req.actor, filters, id);
  const rtl = req.acceptsLanguages('ar', 'en') === 'ar';
  // Only a human-accepted AI text may appear in a report, and it is labelled as such.
  const ai = id ? await aiService.acceptedNarrative(req.actor, id, data.filters) : null;
  const breakdown = (rows, daily = false) =>
    rows.map((row) => [
      daily ? date(row.id) : (rtl && row.labelAr) || row.label || row.id,
      ...metrics.map((metric) => metricValue(row, metric)),
    ]);
  const sheets = [
    {
      name: 'Summary',
      headers: ['Measure', 'Value'],
      rows: [
        ['Generated at', data.generatedAt],
        ['Filters', JSON.stringify(data.filters)],
        ['Definitions', definitions.join('\n\n')],
        ...metrics.map((metric) => [metric[0], metricValue(data.kpis, metric)]),
        ...(ai?.text
          ? [
              [
                `AI commentary (AI-generated, reviewed by ${ai.reviewedBy ?? '-'} on ${ai.reviewedAt.toISOString().slice(0, 10)}; period ${ai.period.from} to ${ai.period.to})`,
                ai.text,
              ],
            ]
          : []),
      ],
    },
    ...[
      ['By day', 'Work date', data.daily],
      ['By wilaya', 'Wilaya', data.wilayas],
      ['By store', 'Point de Vente', data.stores],
      ['By Animateur', 'Animateur', data.animateurs],
    ].map(([name, label, rows]) => ({
      name,
      headers: [label, ...metrics.map(([title]) => title)],
      rows: breakdown(rows, name === 'By day'),
    })),
    {
      name: 'Gifts',
      headers: [
        'Campaign',
        'Holder',
        'SKU',
        'Received',
        'Sent',
        'Returned',
        'Distributed',
        'Adjusted',
        'Balance',
        'Check',
      ],
      rows: data.gifts.map((g) => [
        g.campaign,
        g.holder.fullName ?? g.holder.kind,
        g.sku,
        g.received,
        g.sent,
        g.returned,
        g.distributed,
        g.adjusted,
        g.balance,
        g.check.ok,
      ]),
    },
    {
      name: 'Visits',
      headers: ['Work date', 'Visits', 'Visited stores', 'Store coverage'],
      rows: data.daily.map((row) => [
        date(row.id),
        row.visits.count,
        row.visits.storesVisited,
        row.visits.storeCoverage,
      ]),
    },
    {
      name: 'Issues',
      headers: ['Category', 'Status', 'Count'],
      rows: data.issues.map((issue) => [issue.category, issue.status, issue.count]),
    },
  ];
  if (sheets.some(({ rows }) => rows.length > MAX_ROWS))
    throw new AppError({
      status: 422,
      code: ERROR_CODES.EXPORT_TOO_LARGE,
      message: 'Narrow the reporting filters and try again',
    });
  await auditService.record(prisma, {
    actor: req.actor,
    action: 'report.exported',
    entityType: 'report',
    entityId: id ?? req.actor.id,
    after: { view, filters: data.filters },
    req,
  });

  res.setHeader('Content-Type', XLSX);
  res.setHeader('Cache-Control', 'private, no-store');
  res.attachment(`fieldflow-${view}.xlsx`);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  for (const { name, headers, rows } of sheets) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: rtl }],
    });
    sheet.columns = headers.map((header, index) => ({
      width: index === 0 ? 32 : name === 'Summary' ? 94 : Math.max(18, header.length + 4),
      style:
        name.startsWith('By ') && metrics[index - 1]?.[3]
          ? { numFmt: metrics[index - 1][3] }
          : undefined,
    }));
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: headers.length },
    };
    const heading = sheet.addRow(headers);
    // ActiCrew brand: black header row, white bold text.
    heading.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });
    heading.commit();
    rows.forEach((values, index) => {
      const row = sheet.addRow(values);
      values.forEach((value, col) => {
        if (value instanceof Date)
          row.getCell(col + 1).numFmt = col === 0 ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm';
      });
      if (name === 'Summary' && metrics[index - 3]?.[3])
        row.getCell(2).numFmt = metrics[index - 3][3];
      if (name === 'Summary' && index === 2) {
        row.height = 270;
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }
      if (name === 'Visits') row.getCell(4).numFmt = '0.0%';
      row.commit();
    });
    sheet.commit();
  }
  await workbook.commit();
}
