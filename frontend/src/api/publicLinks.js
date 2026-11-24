// Public share links: no Bearer token, no refresh logic.
import api, { unwrap, API_BASE } from './client.js';

const open = { skipAuth: true };
const withAt = (at) => (at ? { params: { at }, skipAuth: true } : open);

/**
 * Locked links return only { kind, requiresPassword, unlocked:false, canDownload, expiresAt }.
 * Pass the unlock token to also get name/size/previewKind/sharedBy. Revoked/expired links reject with HTTP 410.
 */
export const metadata = (token, unlockToken) => unwrap(api.get(`/public/links/${token}`, withAt(unlockToken)));
/** Wrong password rejects with 403 INVALID_LINK_PASSWORD. @returns {{accessToken, expiresAt}} */
export const unlock = (token, password) => unwrap(api.post(`/public/links/${token}/unlock`, { password }, open));
/** Folder links only. @returns {{folder, breadcrumbs, canDownload, folders:[{id,name,updatedAt}], files:[...]}} */
export const browse = (token, { folderId, unlockToken } = {}) =>
  unwrap(api.get(`/public/links/${token}/folder`, { skipAuth: true, params: { ...(folderId ? { folderId } : {}), ...(unlockToken ? { at: unlockToken } : {}) } }));

/** URL for <a href>/<img>/<iframe>. unlockToken only when the link is password-protected. fileId only for folder links. */
export function url(token, action = 'download', unlockToken, fileId) {
  const qs = unlockToken ? `?at=${encodeURIComponent(unlockToken)}` : '';
  const path = fileId ? `/public/links/${token}/files/${fileId}/${action}` : `/public/links/${token}/${action}`;
  return `${API_BASE}${path}${qs}`;
}
