import api, { unwrap } from './client.js';

export const updateProfile = (body) => unwrap(api.patch('/users/me', body)).then((d) => d.user);
export const updatePreferences = (body) => unwrap(api.patch('/users/me/preferences', body)).then((d) => d.user); // { theme?, notificationPrefs? }
export const changePassword = (body) => unwrap(api.patch('/users/me/password', body)); // { currentPassword, newPassword }
export const listSessions = (opts) => unwrap(api.get('/users/me/sessions', opts)).then((d) => d.sessions);
export const revokeSession = (id) => unwrap(api.delete(`/users/me/sessions/${id}`));
export const revokeOtherSessions = () => unwrap(api.delete('/users/me/sessions'));
export const lookup = (q, opts) => unwrap(api.get('/users/lookup', { params: { q }, ...opts })).then((d) => d.users); // [{id,name,email}]

export const uploadAvatar = (file, { onProgress } = {}) => {
  const form = new FormData();
  form.append('avatar', file);
  return unwrap(api.post('/users/me/avatar', form, {
    onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
  })).then((d) => d.user);
};
export const deleteAvatar = () => unwrap(api.delete('/users/me/avatar')).then((d) => d.user);
/** Avatars need the Bearer header, so <img src> will not work: fetch as a blob. */
export const fetchAvatarBlob = (userId, opts) =>
  api.get(`/users/${userId}/avatar`, { responseType: 'blob', ...opts }).then((r) => r.data);
