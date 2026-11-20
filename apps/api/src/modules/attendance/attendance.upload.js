import { maxUploadBytes } from '@fieldflow/shared';
import multer from 'multer';
import { ValidationError } from '../../core/errors/index.js';
import { fileTooLarge } from '../files/files.service.js';

export function uploadPhotos(kind, field, limit) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes(kind),
      files: limit,
      fields: 8,
      fieldSize: 32_768,
      parts: limit + 8,
    },
  });
  const handle = limit === 1 ? upload.single(field) : upload.array(field, limit);
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      return next(new ValidationError([{ path: 'body', message: 'Expected multipart/form-data' }]));
    }
    handle(req, res, (error) => {
      if (error?.code === 'LIMIT_FILE_SIZE') return next(fileTooLarge());
      if (error)
        return next(
          new ValidationError([{ path: 'body.' + field, message: 'Invalid multipart upload' }]),
        );
      next();
    });
  };
}
