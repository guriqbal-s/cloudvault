// File type knowledge shared by upload validation, DTOs, previews and the dashboard charts.
// Only the formats from the product spec are allowed (see ALLOWED_EXTENSIONS in .env).

/** extension -> canonical MIME type */
export const MIME_BY_EXT = Object.freeze({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  zip: 'application/zip',
});

/** extension -> category used by icons, filters and charts */
const CATEGORY_BY_EXT = Object.freeze({
  pdf: 'pdf',
  doc: 'document', docx: 'document',
  txt: 'text',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  mp4: 'video',
  zip: 'archive',
});

export const CATEGORIES = Object.freeze(['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'video', 'archive', 'text', 'other']);

export const CATEGORY_LABELS = Object.freeze({
  image: 'Images', pdf: 'PDFs', document: 'Documents', spreadsheet: 'Spreadsheets',
  presentation: 'Presentations', video: 'Videos', archive: 'Archives', text: 'Text files', other: 'Other',
});

/** category -> extensions (used to build "filter by type" queries) */
export const EXTENSIONS_BY_CATEGORY = Object.freeze(
  Object.entries(CATEGORY_BY_EXT).reduce((acc, [ext, cat]) => {
    (acc[cat] ??= []).push(ext);
    return acc;
  }, {})
);

/** Extensions that may be shown inline in the browser (preview), grouped by how. */
export const PREVIEWABLE = Object.freeze({
  image: ['jpg', 'jpeg', 'png', 'gif'],
  pdf: ['pdf'],
  video: ['mp4'],
  text: ['txt', 'csv'],
});

/** Lower-cased extension without the dot; '' when there is none. */
export function extensionOf(filename) {
  const name = String(filename ?? '');
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileCategory(extension) {
  return CATEGORY_BY_EXT[String(extension ?? '').toLowerCase()] ?? 'other';
}

/** @returns {'image'|'pdf'|'video'|'text'|null} how the file can be previewed, or null */
export function previewKind(extension) {
  const ext = String(extension ?? '').toLowerCase();
  for (const [kind, list] of Object.entries(PREVIEWABLE)) if (list.includes(ext)) return kind;
  return null;
}
