import { maxUploadBytes } from '@fieldflow/shared';
import multer from 'multer';
import { ValidationError } from '../../core/errors/index.js';
import { fileTooLarge } from '../files/files.service.js';

/**
 * Optional proof file: a JSON request passes through; a `multipart/form-data` one carries the text
 * fields plus one `file` part, kept in memory (the content is sniffed and re-encoded by the file
 * service). `lines` travels as a JSON string in the multipart form.
 * @param {string} kind
 * @returns {import('express').RequestHandler}
 */
export function uploadOptionalProof(kind) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes(kind), files: 1, fields: 8, fieldSize: 16_384, parts: 10 },
  }).single('file');
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    handler(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(fileTooLarge());
      if (err)
        return next(
          new ValidationError([{ path: 'body.file', message: 'Invalid multipart body' }]),
        );
      next();
    });
  };
}
