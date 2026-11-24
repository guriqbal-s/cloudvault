import api, { unwrap, unwrapPage, clean } from './client.js';

/**
 * Folder contents. id = 'root' or a folder id.
 * params: q, sort, order, type, page, limit (apply to files).
 * @returns {{data:{folder,breadcrumbs,folders,files}, meta}}
 */
export const open = (id = 'root', params, opts) =>
  unwrapPage(api.get(`/folders/${id}`, { params: clean(params), ...opts }));
export const create = ({ name, parentId }) => unwrap(api.post('/folders', { name, parentId: parentId ?? undefined }));
export const update = (id, body) => unwrap(api.patch(`/folders/${id}`, body)); // { name?, parentId? }
export const remove = (id) => unwrap(api.delete(`/folders/${id}`));
