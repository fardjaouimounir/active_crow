import { ERROR_CODES } from '@fieldflow/shared';
import { AppError } from '../errors/index.js';

export function coversDay(assignment, date) {
  const day = new Date(date + 'T00:00:00.000Z');
  const weekday = day.getUTCDay() || 7;
  return (
    assignment.startDate <= day &&
    assignment.endDate >= day &&
    (!assignment.workDays?.length || assignment.workDays.includes(weekday))
  );
}

export function assertFieldEntry(assignment, date) {
  let reason;
  if (assignment.status !== 'approved') reason = 'assignment_not_approved';
  else if (!coversDay(assignment, date)) reason = 'outside_assignment_work_days';
  else if (assignment.campaign.status !== 'active') reason = 'campaign_not_active';
  if (reason)
    throw new AppError({
      status: 422,
      code: ERROR_CODES.FIELD_ENTRY_NOT_ALLOWED,
      message: 'Field entry is unavailable',
      details: { reason },
    });
}
