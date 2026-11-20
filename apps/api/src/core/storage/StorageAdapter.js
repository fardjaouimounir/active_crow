/**
 * Where file bytes live. `LocalDiskAdapter` now; an S3-compatible adapter later implements the same
 * methods. Keys come from `buildKeys()` and are validated by `assertKey()` in every adapter.
 *
 * @typedef {object} StorageAdapter
 * @property {(key: string, buffer: Buffer, contentType: string) => Promise<void>} put
 * @property {(key: string) => Promise<import('node:stream').Readable>} getStream
 * @property {(key: string) => Promise<boolean>} exists
 * @property {(key: string) => Promise<void>} remove deletes orphan bytes after a failed transaction
 */

export {};
