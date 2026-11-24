import api, { unwrap } from './client.js';

/** type: 'files' | 'folders' */
export const list = (opts) => unwrap(api.get('/starred', opts)); // { folders, files }
export const star = (type, id) => unwrap(api.put(`/starred/${type}/${id}`));
export const unstar = (type, id) => unwrap(api.delete(`/starred/${type}/${id}`));
export const toggle = (type, id, starred) => (starred ? unstar(type, id) : star(type, id));
