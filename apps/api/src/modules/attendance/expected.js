import { NotFoundError } from '../../core/errors/index.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { coversDay } from '../../core/time/fieldEntry.js';
import { ruleSetsService } from '../campaigns/ruleSets.service.js';
import * as repository from './attendance.repository.js';

export const asDate = (date) => new Date(date + 'T00:00:00.000Z');
export const dateText = (date) => date.toISOString().slice(0, 10);
export const algiersInstant = (date, time) => new Date(`${date}T${time}:00+01:00`);
export function attendanceRuleOf(ruleSet) {
  const rules = ruleSet?.rules;
  return Array.isArray(rules)
    ? rules.find(({ ruleType }) => ruleType === 'attendance')?.config
    : rules?.attendance;
}

export { coversDay };

export async function activeAssignments(db, scope, date, where = {}) {
  const day = asDate(date);
  const rows = await repository.assignments(db, scope, {
    ...where,
    status: 'approved',
    startDate: { lte: day },
    endDate: { gte: day },
  });
  return rows.filter((row) => coversDay(row, date));
}

export function assignmentSummary(row) {
  const { id, name, wilayaId, wilaya } = row.pointOfSale;
  return {
    assignmentId: row.id,
    campaignId: row.campaignId,
    animateur: row.animateur,
    supervisor: row.supervisor,
    pointOfSale: { id, name, wilayaId, wilaya },
  };
}

export async function expectedCheckpoints(db, scope, campaign, date, instant = clock.now()) {
  const today = businessDate(instant);
  const cutoff = date === today ? instant : new Date(+algiersInstant(date, '00:00') + 86_399_999);
  const day = asDate(date);
  if (day < campaign.startDate || day > campaign.endDate) return [];
  const history = await repository.campaignStatus(db, scope, campaign.id);
  const status =
    history.find(({ createdAt }) => createdAt <= cutoff)?.toStatus ??
    history.at(-1)?.fromStatus ??
    campaign.status;
  if (status !== 'active') return [];

  let version;
  try {
    // The caller already checked attendance's operation-date scope on this campaign.
    version = await ruleSetsService.effective(
      { level: 'agency', agencyId: scope.agencyId },
      campaign.id,
      cutoff,
      db,
    );
  } catch (error) {
    if (error instanceof NotFoundError) return [];
    throw error;
  }
  const rule = attendanceRuleOf(version);
  if (!rule) return [];
  const rows = await activeAssignments(db, scope, date, { campaignId: campaign.id });
  const expected = [];
  for (const row of rows) {
    if (await repository.assignmentVisible(db, scope, row, date)) {
      expected.push({
        ...assignmentSummary(row),
        checkpoints: rule.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          opensAt: algiersInstant(date, checkpoint.window[0]),
          isOpen: date === today && instant >= algiersInstant(date, checkpoint.window[0]),
        })),
      });
    }
  }
  return expected;
}
