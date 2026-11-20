import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import { requireIdempotencyKey } from '../../core/http/idempotency.js';
import * as controller from './attendance.controller.js';
import { uploadPhotos } from './attendance.upload.js';
import * as input from './attendance.validators.js';

const hideClient = (req, _res, next) =>
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);

export function createAttendanceRouter() {
  const router = Router();
  const guards = (permission) => [authenticate, hideClient, requirePermission(permission)];
  const post = (path, permission, body, handler, { upload, idempotent } = {}) => {
    router.post(
      path,
      ...guards(permission),
      ...(upload ? [upload] : []),
      validate({ params: input.params, query: input.empty, body }),
      ...(idempotent ? [requireIdempotencyKey] : []),
      handler,
    );
  };
  const get = (path, permission, query, handler) => {
    router.get(
      path,
      ...guards(permission),
      validate({
        params: path.includes(':id') ? input.params : input.empty,
        query,
        body: input.empty,
      }),
      handler,
    );
  };
  post(
    '/assignments/:id/attendance',
    'attendance.record',
    input.checkpointBody,
    controller.record,
    { upload: uploadPhotos('attendance_photo', 'photo', 1), idempotent: true },
  );
  post('/attendance/:id/verify', 'attendance.review', input.empty, controller.verify);
  post('/attendance/:id/reject', 'attendance.review', input.rejectBody, controller.reject);
  post('/attendance/:id/override', 'attendance.override', input.overrideBody, controller.override);
  post(
    '/campaigns/:id/attendance/verify-bulk',
    'attendance.review',
    input.bulkBody,
    controller.bulk,
  );
  post('/assignments/:id/absences', 'absence.record', input.absenceBody, controller.absence, {
    idempotent: true,
  });
  post('/absences/:id/void', 'absence.void', input.rejectBody, controller.voidAbsence);
  post('/campaigns/:id/visits', 'visit.record', input.visitBody, controller.createVisit, {
    upload: uploadPhotos('visit_photo', 'photos', 5),
    idempotent: true,
  });
  get('/campaigns/:id/attendance/board', 'attendance.read', input.boardQuery, controller.board);
  get('/campaigns/:id/attendance', 'attendance.read', input.recordQuery, controller.list);
  get('/attendance/:id', 'attendance.read', input.empty, controller.detail);
  get('/me/attendance/today', 'attendance.record', input.empty, controller.today);
  get('/me/attendance/review', 'attendance.review', input.empty, controller.overview);
  get('/campaigns/:id/visits', 'visit.read', input.visitQuery, controller.listVisits);
  get('/campaigns/:id/visits/options', 'visit.record', input.empty, controller.visitOptions);
  get('/visits/:id', 'visit.read', input.empty, controller.visitDetail);
  return router;
}
