import api, { unwrap } from './client.js';

/** type: 'files' | 'folders' */
export const list = (opts) => unwrap(api.get('/trash', opts)); // { folders, files }
export const restore = (type, id) => unwrap(api.post(`/trash/${type}/${id}/restore`));
export const purge = (type, id) => unwrap(api.delete(`/trash/${type}/${id}`));
export const empty = () => unwrap(api.delete('/trash'));
