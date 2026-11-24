import api, { unwrap } from './client.js';

/**
 * Upload one or many files. @returns {{results:[{name, ok, file?, error?}]}}
 * options: { folderId, onProgress(fraction 0..1), signal }
 */
export function upload(files, { folderId, onProgress, signal } = {}) {
  const form = new FormData();
  if (folderId) form.append('folderId', folderId); // text fields before files so the server can read them first
  for (const f of files) form.append('files', f);
  return unwrap(api.post('/files/upload', form, {
    signal,
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  }));
}

export const get = (id, opts) => unwrap(api.get(`/files/${id}`, opts));
export const update = (id, body) => unwrap(api.patch(`/files/${id}`, body)); // { name?, folderId? }
export const remove = (id) => unwrap(api.delete(`/files/${id}`));

/** Short-lived signed URL usable in <img>, <video>, <iframe>, or a plain link. purpose: 'download'|'preview' */
export const accessUrl = (id, purpose = 'preview') => unwrap(api.post(`/files/${id}/access-url`, { purpose }));

/** Start a browser download of the current version. */
export async function download(id) {
  const { url } = await accessUrl(id, 'download');
  triggerDownload(url);
}

export function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Fetch text content (txt/csv preview) through the signed URL. */
export async function fetchText(id, { maxChars = 200_000 } = {}) {
  const { url } = await accessUrl(id, 'preview');
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('Could not load the file preview.');
  const text = await res.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

// Versions
export const listVersions = (id, opts) => unwrap(api.get(`/files/${id}/versions`, opts));
export function uploadVersion(id, file, { comment, onProgress } = {}) {
  const form = new FormData();
  if (comment) form.append('comment', comment);
  form.append('file', file);
  return unwrap(api.post(`/files/${id}/versions`, form, {
    timeout: 0,
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  }));
}
export const restoreVersion = (id, n) => unwrap(api.post(`/files/${id}/versions/${n}/restore`));
export const deleteVersion = (id, n) => unwrap(api.delete(`/files/${id}/versions/${n}`));
/** Downloads a specific version (needs the Bearer header, so streamed to a blob and saved). */
export async function downloadVersion(id, n, filename = 'download') {
  const res = await api.get(`/files/${id}/versions/${n}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
