import api, { unwrap, unwrapPage, clean } from './client.js';

/** params: unread (true), page, limit. @returns {{data: Notification[], meta: {..., unreadCount}}} */
export const list = (params, opts) =>
  unwrapPage(api.get('/notifications', { params: clean(params), ...opts })).then(({ data, meta }) => ({ data: data.notifications, meta }));
export const markRead = (id) => unwrap(api.patch(`/notifications/${id}/read`));
export const markAllRead = () => unwrap(api.post('/notifications/read-all'));
export const remove = (id) => unwrap(api.delete(`/notifications/${id}`));
