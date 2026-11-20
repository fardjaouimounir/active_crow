import { operation } from '../../core/http/openapi.js';
import * as input from './attendance.validators.js';

export function registerAttendanceOpenApi(registry) {
  const add = (method, path, summary, permission, options = {}) =>
    registry.register(
      operation(method, path, summary, permission, {
        ...(path.includes('{id}') ? { params: input.params } : {}),
        ...options,
      }),
    );
  add(
    'post',
    '/assignments/{id}/attendance',
    'Record checkpoint (Idempotency-Key required)',
    'attendance.record',
    {
      status: 201,
      idempotent: true,
      multipart: { fields: input.checkpointBody, name: 'photo', required: false },
    },
  );
  add('post', '/attendance/{id}/verify', 'Verify proof', 'attendance.review', {
    body: input.empty,
  });
  add('post', '/attendance/{id}/reject', 'Reject proof', 'attendance.review', {
    body: input.rejectBody,
  });
  add('post', '/attendance/{id}/override', 'Override a decision', 'attendance.override', {
    body: input.overrideBody,
  });
  add(
    'post',
    '/campaigns/{id}/attendance/verify-bulk',
    'Verify proofs in bulk',
    'attendance.review',
    { body: input.bulkBody },
  );
  add(
    'post',
    '/assignments/{id}/absences',
    'Record absence (Idempotency-Key required)',
    'absence.record',
    { status: 201, body: input.absenceBody, idempotent: true },
  );
  add('post', '/absences/{id}/void', 'Void absence', 'absence.void', { body: input.rejectBody });
  add('post', '/campaigns/{id}/visits', 'Record visit (Idempotency-Key required)', 'visit.record', {
    status: 201,
    idempotent: true,
    multipart: {
      fields: input.visitBody,
      name: 'photos',
      multiple: true,
      maxItems: 5,
      required: true,
    },
  });
  add('get', '/campaigns/{id}/attendance/board', 'Daily attendance board', 'attendance.read', {
    query: input.boardQuery,
  });
  add('get', '/campaigns/{id}/attendance', 'List attendance records', 'attendance.read', {
    query: input.recordQuery,
    list: true,
  });
  add('get', '/attendance/{id}', 'Attendance proof and history', 'attendance.read');
  add('get', '/me/attendance/today', 'Today’s checkpoints', 'attendance.record');
  add('get', '/me/attendance/review', 'Today’s review queue', 'attendance.review');
  add('get', '/campaigns/{id}/visits', 'List visits', 'visit.read', {
    query: input.visitQuery,
    list: true,
  });
  add(
    'get',
    '/campaigns/{id}/visits/options',
    'Eligible points of sale and observed Animateurs',
    'visit.record',
    { array: true },
  );
  add('get', '/visits/{id}', 'Visit detail', 'visit.read');
}
