import { ERROR_CODES, reportingDimensions } from '@fieldflow/shared';
import { AppError } from '../../core/errors/index.js';
import { reportingService } from './reporting.service.js';
import { download } from './reporting.excel.js';

export async function kpis(req, res) {
  res.json({ data: await reportingService.kpis(req.actor, req.query) });
}

export async function breakdown(req, res) {
  const { dimension, ...filters } = req.query;
  if (!reportingDimensions.includes(dimension))
    throw new AppError({
      status: 422,
      code: ERROR_CODES.INVALID_DIMENSION,
      message: 'Invalid reporting dimension',
    });
  res.json({ data: await reportingService.breakdown(req.actor, filters, dimension) });
}

export async function summary(req, res) {
  res.json({ data: await reportingService.summary(req.actor, req.params.id) });
}

export async function exportDashboard(req, res) {
  const { view, ...filters } = req.query;
  await download(req, res, { filters, view });
}

export async function exportCampaign(req, res) {
  await download(req, res, { id: req.params.id, view: 'campaign' });
}
