import { createReadStream, mkdirSync } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertKey } from './keys.js';

/**
 * Stores files on the local disk under `root` (env UPLOAD_DIR), outside the web root.
 * @implements {import('./StorageAdapter.js').StorageAdapter}
 */
export class LocalDiskAdapter {
  /** @param {string} root absolute directory, created if missing */
  constructor(root) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  /** @param {string} key */
  path(key) {
    const target = resolve(this.root, assertKey(key));
    if (!target.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return target;
  }

  /** @param {string} key @param {Buffer} buffer @param {string} _contentType */
  async put(key, buffer, _contentType) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });
  }

  /** @param {string} key */
  async getStream(key) {
    return createReadStream(this.path(key));
  }

  /** @param {string} key */
  async exists(key) {
    try {
      await access(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} key */
  async remove(key) {
    await rm(this.path(key), { force: true });
  }
}
