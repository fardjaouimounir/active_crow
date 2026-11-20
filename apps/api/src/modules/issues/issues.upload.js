import { maxUploadBytes } from '@fieldflow/shared';
import multer from 'multer';
import { AppError, ValidationError } from '../../core/errors/index.js';
import { fileTooLarge } from '../files/files.service.js';

const parse = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes('issue_attachment'),
    files: 3,
    fields: 6,
    fieldSize: 8192,
    parts: 10,
  },
}).array('files', 3);

export function uploadIssueAttachments(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  parse(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(fileTooLarge());
    if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(err?.code))
      return next(
        new AppError({
          status: 422,
          code: 'TOO_MANY_ATTACHMENTS',
          message: 'Use at most three attachments',
        }),
      );
    if (err)
      return next(new ValidationError([{ path: 'body.files', message: 'Invalid multipart body' }]));
    next();
  });
}
