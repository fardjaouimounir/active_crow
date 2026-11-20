// File storage pipeline: sniff the content type, enforce the per-kind rules, re-encode images
// (metadata stripped), write the bytes, then insert the `files` row in the caller's transaction.
// Image processing runs in the request for now; callers only see `store()`, so it can move to a
// background job later.
import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  fileRuleFor,
  IMAGE_MIME_TYPES,
  SHAREABLE_FILE_KINDS,
} from '@fieldflow/shared';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { auditService } from '../../core/audit/index.js';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { buildKeys, storage } from '../../core/storage/index.js';
import { clock } from '../../core/time/clock.js';
import { withTransaction } from '../../db/transaction.js';
import { decideFileAccess } from './fileAccessPolicies.js';
import * as repository from './files.repository.js';

export const IMAGE_MAX_SIDE = 1600;
export const THUMBNAIL_MAX_SIDE = 400;
const WEBP_QUALITY = 80;

export const fileTooLarge = () =>
  new AppError({ status: 413, code: ERROR_CODES.FILE_TOO_LARGE, message: 'The file is too large' });
const typeNotAllowed = () =>
  new AppError({
    status: 422,
    code: ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
    message: 'This type of file is not allowed here',
  });

/** Keys written during each `transaction()`, removed again if it does not commit. */
const pendingKeys = new WeakMap();

/**
 * Runs `work(tx)` in a transaction in which `store()` may be called. If the transaction fails, the
 * bytes written for it are deleted, so no orphan file stays on disk.
 * @template T
 * @param {(tx: object) => Promise<T>} work
 * @param {Parameters<typeof withTransaction>[1]} [options]
 * @returns {Promise<T>}
 */
async function transaction(work, options = {}) {
  const keys = [];
  try {
    return await withTransaction(
      (tx) => {
        pendingKeys.set(tx, keys);
        return work(tx);
      },
      { timeoutMs: 30_000, ...options },
    );
  } catch (err) {
    await Promise.allSettled(keys.map((key) => storage.remove(key)));
    throw err;
  }
}

const resized = (buffer, side) =>
  sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY });

/** EXIF orientation applied, then every metadata block dropped (sharp keeps none by default). */
async function processImage(buffer) {
  try {
    const { data, info } = await resized(buffer, IMAGE_MAX_SIDE).toBuffer({
      resolveWithObject: true,
    });
    const thumbnail = await resized(buffer, THUMBNAIL_MAX_SIDE).toBuffer();
    return {
      data,
      thumbnail,
      mimeType: 'image/webp',
      ext: 'webp',
      width: info.width,
      height: info.height,
    };
  } catch {
    throw typeNotAllowed();
  }
}

/**
 * Validates, processes and stores an uploaded file; inserts its `files` row (internal) with `tx`.
 * Must run inside `fileService.transaction()`.
 * @param {object} tx
 * @param {{ actor: { id: string, agencyId: string }, kind: string, buffer: Buffer, originalName?: string }} input
 *   `originalName` is never stored (no client file name in keys or rows).
 */
async function store(tx, { actor, kind, buffer }) {
  const keys = pendingKeys.get(tx);
  if (!keys) throw new Error('fileService.store() must run inside fileService.transaction()');
  const detected = await fileTypeFromBuffer(buffer);
  const rule = detected && fileRuleFor(kind, detected.mime);
  if (!rule) throw typeNotAllowed();
  if (buffer.length > rule.maxBytes) throw fileTooLarge();

  const processed = IMAGE_MIME_TYPES.includes(detected.mime)
    ? await processImage(buffer)
    : { data: buffer, thumbnail: null, mimeType: detected.mime, ext: detected.ext };
  const { key, thumbnailKey } = buildKeys({
    agencyId: actor.agencyId,
    kind,
    ext: processed.ext,
    at: clock.now(),
  });
  keys.push(key);
  await storage.put(key, processed.data, processed.mimeType);
  if (processed.thumbnail) {
    keys.push(thumbnailKey);
    await storage.put(thumbnailKey, processed.thumbnail, 'image/webp');
  }

  const file = await repository.createFile(tx, actor, {
    kind,
    storageKey: key,
    thumbnailKey: processed.thumbnail ? thumbnailKey : null,
    mimeType: processed.mimeType,
    sizeBytes: processed.data.length,
    sha256: createHash('sha256').update(processed.data).digest('hex'),
    width: processed.width ?? null,
    height: processed.height ?? null,
    uploadedById: actor.id,
  });
  await auditService.record(tx, {
    actor: { type: 'user', id: actor.id, agencyId: actor.agencyId },
    action: 'file.uploaded',
    entityType: 'file',
    entityId: file.id,
    after: {
      id: file.id,
      kind,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    },
  });
  return file;
}

/** Q-16 / Module 11: only shareable kinds may become client-visible; readers still need access. */
function setVisibility(scope, actor, id, visibility) {
  return withTransaction(async (tx) => {
    const before = await repository.findFile(tx, scope, id);
    if (!before) throw new NotFoundError();
    if (visibility === 'client_visible' && !SHAREABLE_FILE_KINDS.includes(before.kind)) {
      throw new AppError({
        status: 422,
        code: ERROR_CODES.VISIBILITY_NOT_ALLOWED_FOR_KIND,
        message: 'This kind of file can never be shared with the client',
      });
    }
    if (!(await decideFileAccess(actor, before, tx))) throw new NotFoundError();
    const after = await repository.setVisibility(tx, scope, id, visibility);
    await auditService.record(tx, {
      actor,
      action: 'file.visibility_changed',
      entityType: 'file',
      entityId: id,
      before: { visibility: before.visibility },
      after: { visibility },
    });
    return { id, visibility: after.visibility };
  });
}

/** Opens the stored bytes of a file (or its thumbnail). */
async function open(file, variant) {
  const key = variant === 'thumbnail' ? file.thumbnailKey : file.storageKey;
  if (!key || !(await storage.exists(key))) throw new NotFoundError();
  return {
    stream: await storage.getStream(key),
    contentType: variant === 'thumbnail' ? 'image/webp' : file.mimeType,
  };
}

export const fileService = Object.freeze({ transaction, store, setVisibility, open });
