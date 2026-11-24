import api, { unwrap, unwrapPage, clean } from './client.js';

export const stats = (opts) => unwrap(api.get('/admin/stats', opts));

/** params: q, status, role, page, limit, sort, order. @returns {{data: User[], meta}} */
export const listUsers = (params, opts) =>
  unwrapPage(api.get('/admin/users', { params: clean(params), ...opts })).then(({ data, meta }) => ({ data: data.users, meta }));
export const createUser = (body) => unwrap(api.post('/admin/users', body)).then((d) => d.user); // { name, email, password, roleKey, quotaBytes? }
export const getUser = (id, opts) => unwrap(api.get(`/admin/users/${id}`, opts)).then((d) => d.user);
export const updateUser = (id, body) => unwrap(api.patch(`/admin/users/${id}`, body)).then((d) => d.user); // { name?, status?, quotaBytes? }
export const setUserRoles = (id, roleKeys) => unwrap(api.put(`/admin/users/${id}/roles`, { roleKeys })).then((d) => d.user);
/** purge=true also deletes the user's files (otherwise 409 USER_HAS_CONTENT when they own content). */
export const deleteUser = (id, { purge = false } = {}) => unwrap(api.delete(`/admin/users/${id}`, { params: purge ? { purge: 'true' } : undefined }));
export const revokeUserSessions = (id) => unwrap(api.post(`/admin/users/${id}/revoke-sessions`));

export const listRoles = (opts) => unwrap(api.get('/admin/roles', opts)).then((d) => d.roles);
/** params: userId, action, from, to, q, page, limit */
export const listActivity = (params, opts) =>
  unwrapPage(api.get('/admin/activity', { params: clean(params), ...opts })).then(({ data, meta }) => ({ data: data.activity, meta }));
export const storageOverview = (opts) => unwrap(api.get('/admin/storage', opts));
