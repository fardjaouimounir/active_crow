import { maxUploadBytes } from '@fieldflow/shared';
import multer from 'multer';
import { ValidationError } from '../../core/errors/index.js';
import { fileTooLarge } from './files.service.js';

/**
 * Parses one multipart `file` field into memory for `kind`. multer stops reading past the largest
 * size the kind allows (the exact per-type limit is checked after sniffing the content).
 * @param {string} kind
 * @returns {import('express').RequestHandler}
 */
export function uploadFile(kind) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes(kind), files: 1, fields: 5, fieldSize: 4096, parts: 6 },
  }).single('file');
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(
          err.code === 'LIMIT_FILE_SIZE'
            ? fileTooLarge()
            : new ValidationError([
                { path: 'body.' + (err.field ?? 'file'), message: err.message },
              ]),
        );
      }
      if (err) return next(err);
      if (!req.file) {
        return next(new ValidationError([{ path: 'body.file', message: 'A file is required' }]));
      }
      req.body ??= {};
      next();
    });
}
