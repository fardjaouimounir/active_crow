// Client variant of the final report workbook: the same KPIs, no Animateur or supervisor sheet, no
// per-holder gifts, no issues. AI text only when a person accepted it, and it says so.
import ExcelJS from 'exceljs';
import { auditService } from '../../core/audit/index.js';
import { prisma } from '../../db/client.js';
import { aiService } from '../ai/ai.service.js';
import { XLSX, definitions, metrics } from '../reporting/reporting.columns.js';
import { reportingService } from '../reporting/reporting.service.js';
import { campaignFor } from './portal.service.js';

const INTERNAL = new Set(['Failed reconciliation checks', 'Gifts to review']);
const clientMetrics = metrics.filter(([title]) => !INTERNAL.has(title));
const value = (data, [, group, key]) => data[group]?.[key] ?? null;
const ISO = (date) => date.toISOString().slice(0, 10);

function narrative(output) {
  const text = (item) => (typeof item === 'string' ? item : (item?.text ?? ''));
  return [
    output.narrative,
    ...(output.risks ?? []).map(text),
    ...(output.opportunities ?? []).map(text),
    ...(output.decisions ?? []).map(text),
  ]
    .filter((line) => typeof line === 'string' && line.trim())
    .join('\n');
}

export async function download(req, res, id) {
  const campaign = await campaignFor(req.actor, id);
  const rtl = req.acceptsLanguages('ar', 'en') === 'ar';
  const period = { from: ISO(campaign.startDate), to: ISO(campaign.endDate) };
  const [kpis, day, wilaya, store, product, commentary] = await Promise.all([
    reportingService.portalAggregates(campaign),
    reportingService.portalAggregates(campaign, 'day'),
    reportingService.portalAggregates(campaign, 'wilaya'),
    reportingService.portalAggregates(campaign, 'point_of_sale'),
    reportingService.portalAggregates(campaign, 'product'),
    aiService.portalCommentary(campaign.agencyId, id, period),
  ]);
  const breakdown = (rows, daily = false) =>
    rows.map((row) => [
      daily ? new Date(`${row.id}T00:00:00Z`) : (rtl && row.labelAr) || row.label || row.id,
      ...clientMetrics.map((metric) => value(row, metric)),
    ]);
  const sheets = [
    {
      name: 'Summary',
      headers: ['Measure', 'Value'],
      rows: [
        ['Campaign', `${campaign.code} ${campaign.name}`],
        ['Period', `${period.from} to ${period.to}`],
        ['Status', campaign.status === 'closed' ? 'Final' : 'Provisional'],
        ['Definitions', definitions.join('\n\n')],
        ...clientMetrics.map((metric) => [metric[0], value(kpis, metric)]),
        ...(commentary
          ? [
              [
                `AI commentary (AI-generated, reviewed by the agency on ${ISO(commentary.reviewedAt)}; period ${period.from} to ${period.to})`,
                narrative(commentary.output),
              ],
            ]
          : []),
      ],
    },
    ...[
      ['By day', 'Work date', day, true],
      ['By wilaya', 'Wilaya', wilaya],
      ['By store', 'Point de Vente', store],
      ['By product', 'Product', product],
    ].map(([name, label, rows, daily]) => ({
      name,
      headers: [label, ...clientMetrics.map(([title]) => title)],
      rows: breakdown(rows, daily),
    })),
  ];
  await auditService.record(prisma, {
    actor: req.actor,
    action: 'report.exported',
    entityType: 'report',
    entityId: id,
    after: { view: 'portal' },
    req,
  });
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Cache-Control', 'private, no-store');
  res.attachment('fieldflow-report.xlsx');
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  for (const { name, headers, rows } of sheets) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: rtl }],
    });
    sheet.columns = headers.map((header, index) => ({
      width: index === 0 ? 32 : name === 'Summary' ? 94 : Math.max(18, header.length + 4),
    }));
    const heading = sheet.addRow(headers);
    heading.font = { bold: true };
    heading.commit();
    for (const values of rows) {
      const row = sheet.addRow(values);
      values.forEach((cell, index) => {
        if (cell instanceof Date) row.getCell(index + 1).numFmt = 'yyyy-mm-dd';
      });
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.commit();
    }
    sheet.commit();
  }
  await workbook.commit();
}
