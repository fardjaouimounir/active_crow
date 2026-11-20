// Upload rules per file kind: the single map used by the API (after sniffing the content) and by the
// web app (client-side pre-check). Change limits here only.

const MB = 1024 * 1024;
export const IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const PDF = Object.freeze(['application/pdf']);

/** kind → allowed content types, each group with its own size limit (bytes). */
export const FILE_KIND_RULES = Object.freeze({
  campaign_document: Object.freeze([
    { mimeTypes: PDF, maxBytes: 20 * MB },
    { mimeTypes: IMAGE_MIME_TYPES, maxBytes: 10 * MB },
  ]),
  attendance_proof: Object.freeze([{ mimeTypes: IMAGE_MIME_TYPES, maxBytes: 5 * MB }]),
  visit_photo: Object.freeze([{ mimeTypes: IMAGE_MIME_TYPES, maxBytes: 5 * MB }]),
  issue_attachment: Object.freeze([
    { mimeTypes: IMAGE_MIME_TYPES, maxBytes: 5 * MB },
    { mimeTypes: PDF, maxBytes: 10 * MB },
  ]),
  stock_document: Object.freeze([
    { mimeTypes: PDF, maxBytes: 10 * MB },
    { mimeTypes: IMAGE_MIME_TYPES, maxBytes: 10 * MB },
  ]),
  stock_adjustment_proof: Object.freeze([{ mimeTypes: IMAGE_MIME_TYPES, maxBytes: 5 * MB }]),
});

export const FILE_KINDS = Object.freeze(Object.keys(FILE_KIND_RULES));

/** Only these kinds may become `client_visible` (Module 11: attendance photos stay internal). */
export const SHAREABLE_FILE_KINDS = Object.freeze(['campaign_document', 'visit_photo']);

/** @param {string} kind @param {string} mimeType @returns {{ mimeTypes: readonly string[], maxBytes: number } | undefined} */
export function fileRuleFor(kind, mimeType) {
  return FILE_KIND_RULES[kind]?.find((rule) => rule.mimeTypes.includes(mimeType));
}

/** Largest upload accepted for a kind (the multer limit, before the content is sniffed). */
export function maxUploadBytes(kind) {
  return Math.max(...(FILE_KIND_RULES[kind] ?? []).map((rule) => rule.maxBytes));
}

/**
 * Client-side pre-check mirroring the server (the server still sniffs the content).
 * @param {string} kind
 * @param {{ type: string, size: number }} file
 * @returns {'FILE_TYPE_NOT_ALLOWED' | 'FILE_TOO_LARGE' | null}
 */
export function checkUpload(kind, { type, size }) {
  const rule = fileRuleFor(kind, type);
  if (!rule) return 'FILE_TYPE_NOT_ALLOWED';
  return size > rule.maxBytes ? 'FILE_TOO_LARGE' : null;
}
