import { fieldInteraction, maxUploadBytes, saleReason, tombolaInput } from '@fieldflow/shared';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import { requireIdempotencyKey, sendIdempotent } from '../../core/http/idempotency.js';
import { fileTooLarge } from '../files/files.service.js';
import * as sales from './sales.service.js';
import * as tombolas from './tombola.service.js';
import * as input from './sales.validators.js';

const proof = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes('sale_proof'),
    files: 1,
    fields: 3,
    fieldSize: 32_768,
    parts: 5,
  },
}).single('proof');
function upload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  proof(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return next(fileTooLarge());
    next(
      error
        ? new ValidationError([{ path: 'body.proof', message: 'Invalid multipart upload' }])
        : undefined,
    );
  });
}
const hideClient = (req, _res, next) =>
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);
const data =
  (fn, status = 200) =>
  async (req, res) =>
    res.status(status).json({ data: await fn(req) });
const page = (fn) => async (req, res) => res.json(await fn(req.actor, req.params.id, req.query));
const write = (fn) => async (req, res) => sendIdempotent(res, await fn(req));
const read = (fn) => data((req) => fn(req.actor, req.params.id));

export function createSalesRouter() {
  const router = Router();
  const guards = (permission, client = false) => [
    authenticate,
    ...(client ? [] : [hideClient]),
    requirePermission(permission),
  ];
  const mutation = (method, path, permission, body, fn, options = {}) =>
    router[method](
      path,
      ...guards(permission),
      ...(options.upload ? [upload] : []),
      validate({ params: input.params, query: input.empty, body }),
      ...(options.idempotent ? [requireIdempotencyKey] : []),
      fn,
    );
  const get = (path, permission, fn, query = input.empty, client = false) =>
    router.get(
      path,
      ...guards(permission, client),
      validate({
        params: path.includes(':id') ? input.params : input.empty,
        query,
        body: input.empty,
      }),
      fn,
    );
  mutation('post', '/assignments/:id/sales', 'sale.record', input.saleBody, write(sales.record), {
    upload: true,
    idempotent: true,
  });
  mutation(
    'post',
    '/assignments/:id/interactions',
    'sale.record',
    fieldInteraction,
    write(sales.recordInteraction),
    { idempotent: true },
  );
  mutation('post', '/entitlements/:id/deliver', 'sale.record', input.empty, write(sales.deliver), {
    idempotent: true,
  });
  mutation(
    'post',
    '/sales/:id/void',
    'sale.void',
    saleReason,
    data((req) => sales.voidSale(req.actor, req.params.id, req.body.reason)),
  );
  mutation(
    'post',
    '/campaigns/:id/tombolas',
    'tombola.manage',
    tombolaInput,
    data((req) => tombolas.configure(req.actor, req.params.id, req.body), 201),
  );
  mutation(
    'patch',
    '/tombolas/:id',
    'tombola.manage',
    input.tombolaPatch,
    data((req) => tombolas.configure(req.actor, req.params.id, req.body, true)),
  );
  mutation('post', '/tombolas/:id/close', 'tombola.manage', input.empty, read(tombolas.close));
  get('/campaigns/:id/sales', 'sale.read', page(sales.list), input.saleQuery);
  get('/campaigns/:id/sales/review', 'sale.read', read(sales.review));
  get('/campaigns/:id/entitlements/undelivered', 'sale.read', read(sales.undelivered));
  get('/campaigns/:id/customers', 'sale.read', read(sales.customers));
  get('/customers/:id', 'customer.read_personal', async (req, res) => {
    const customer = await sales.customerDetail(req.actor, req.params.id);
    res.set('Cache-Control', 'no-store').json({ data: customer });
  });
  get('/campaigns/:id/tombolas', 'tombola.read', read(tombolas.list), input.empty, true);
  get('/tombolas/:id/entries', 'tombola.read', page(tombolas.entries), input.entriesQuery);
  get('/sales/:id', 'sale.read', read(sales.detail));
  get(
    '/me/sales/today',
    'sale.record',
    data((req) => sales.today(req.actor)),
  );
  return router;
}
