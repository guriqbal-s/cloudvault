import api, { unwrap } from './client.js';

/** type: 'files' | 'folders' (path segment used by the API). level: 'VIEWER' | 'EDITOR' */
export const withMe = (opts) => unwrap(api.get('/shares/with-me', opts)); // { folders, files }
export const byMe = (opts) => unwrap(api.get('/shares/by-me', opts)); // { folders, files }
export const details = (type, id, opts) => unwrap(api.get(`/shares/${type}/${id}`, opts)); // { people, links }
export const add = (type, id, { email, level, canDownload }) => unwrap(api.post(`/shares/${type}/${id}`, { email, level, canDownload }));
export const update = (type, id, userId, body) => unwrap(api.patch(`/shares/${type}/${id}/${userId}`, body)); // { level?, canDownload? }
export const revoke = (type, id, userId) => unwrap(api.delete(`/shares/${type}/${id}/${userId}`));

// Share links
export const createLink = (type, id, body) => unwrap(api.post(`/share-links/${type}/${id}`, body)); // { expiresAt?, password?, canDownload? } -> includes token/url
export const updateLink = (linkId, body) => unwrap(api.patch(`/share-links/${linkId}`, body));
export const revokeLink = (linkId) => unwrap(api.delete(`/share-links/${linkId}`));
