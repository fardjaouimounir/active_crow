import { ScopeService } from '../../core/authz/index.js';
import { fileService } from './files.service.js';

/** `inline` with an ASCII fallback and the RFC 5987 UTF-8 name; control and path characters removed. */
export function contentDisposition(name) {
  const clean = [...name.normalize('NFKC')]
    .map((char) => (char.charCodeAt(0) < 32 || char === '\u007f' ? '_' : char))
    .join('')
    .replace(/["\\/:*?<>|;]+/g, '_')
    .trim()
    .slice(0, 150);
  const ascii = clean.replace(/[^ -~]/g, '_') || 'file';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean || 'file')}`;
}

const EXTENSIONS = { 'application/pdf': 'pdf', 'image/webp': 'webp' };

/** Streams a file the `filePolicy()` guard allowed (`req.fileAccess`). */
export const download = (variant) => async (req, res, next) => {
  const { file, filename } = req.fileAccess;
  const { stream, contentType } = await fileService.open(file, variant);
  const base = (filename ?? file.kind + '-' + file.id.slice(0, 8)) + (variant ? '-thumbnail' : '');
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(base + '.' + (EXTENSIONS[contentType] ?? 'bin')),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  });
  stream.on('error', (err) => (res.headersSent ? res.destroy(err) : next(err)));
  stream.pipe(res);
};

export async function setVisibility(req, res) {
  const data = await fileService.setVisibility(
    ScopeService.forRequest(req),
    req.actor,
    req.params.id,
    req.body.visibility,
  );
  res.json({ data });
}
