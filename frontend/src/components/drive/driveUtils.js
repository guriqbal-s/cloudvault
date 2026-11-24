// Small helpers shared by the drive components.

/** 'file' | 'folder' (DTO kind) -> API path segment 'files' | 'folders'. */
export const segmentOf = (item) => (item.kind === 'folder' ? 'folders' : 'files');
/** -> 'FILE' | 'FOLDER' (share endpoints use the segment, labels use this). */
export const labelOf = (item) => (item.kind === 'folder' ? 'folder' : 'file');
export const keyOf = (item) => `${item.kind}:${item.id}`;
export const caps = (item) => item?.access?.capabilities ?? {};
export const isOwner = (item, user) => Boolean(user && item?.ownerId === user.id);

export const PREVIEW_KINDS = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', pdf: 'pdf', mp4: 'video', txt: 'text', csv: 'text',
};
export const previewKindOf = (file) => PREVIEW_KINDS[String(file?.extension ?? '').toLowerCase()] ?? null;

/** Read a persisted UI preference; storage may be unavailable (private mode), so never throw. */
export function readPref(key, fallback) {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writePref(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'document', label: 'Documents' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'video', label: 'Videos' },
  { value: 'archive', label: 'Archives' },
  { value: 'text', label: 'Text files' },
];

export const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'updatedAt:desc', label: 'Recently modified' },
  { value: 'createdAt:desc', label: 'Recently added' },
  { value: 'size:desc', label: 'Largest first' },
  { value: 'size:asc', label: 'Smallest first' },
];
