import { env } from '../../config/env.js';
import { LocalDiskAdapter } from './LocalDiskAdapter.js';

export { assertKey, buildKeys } from './keys.js';
export { LocalDiskAdapter } from './LocalDiskAdapter.js';

const DRIVERS = { local: () => new LocalDiskAdapter(env.UPLOAD_DIR) };

/**
 * The configured adapter (env STORAGE_DRIVER), created at start-up; the upload directory is created
 * then.
 * @type {import('./StorageAdapter.js').StorageAdapter}
 */
export const storage = DRIVERS[env.STORAGE_DRIVER]();
