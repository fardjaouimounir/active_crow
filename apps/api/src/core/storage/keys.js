import { randomUUID } from 'node:crypto';

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * Throws unless `key` is a relative storage key made of safe segments (no `..`, no absolute path,
 * no backslash). Every adapter calls it before touching storage.
 * @param {string} key
 */
export function assertKey(key) {
  if (typeof key !== 'string' || !KEY.test(key) || key.split('/').some((part) => part === '..')) {
    throw new Error('Invalid storage key');
  }
  if (key.includes('..')) throw new Error('Invalid storage key');
  return key;
}

/**
 * `agency/{agencyId}/{kind}/{yyyy}/{mm}/{uuid}.{ext}` (and `{uuid}-thumb.webp` for thumbnails).
 * The original file name never appears in a key.
 * @param {{ agencyId: string, kind: string, ext: string, at?: Date }} input
 */
export function buildKeys({ agencyId, kind, ext, at = new Date() }) {
  for (const part of [agencyId, kind, ext]) {
    if (!SEGMENT.test(part)) throw new Error('Invalid storage key segment');
  }
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const base = ['agency', agencyId, kind, yyyy, mm, randomUUID()].join('/');
  return { key: assertKey(base + '.' + ext), thumbnailKey: assertKey(base + '-thumb.webp') };
}
