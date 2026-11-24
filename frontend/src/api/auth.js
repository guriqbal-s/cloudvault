import api, { unwrap, unwrapMessage } from './client.js';

const open = { skipAuth: true };

export const register = (body) => unwrapMessage(api.post('/auth/register', body, open));
export const login = (body) => unwrap(api.post('/auth/login', body, open)); // -> { user, accessToken }
export const logout = () => api.post('/auth/logout', null, open).then(() => undefined);
export const me = (opts) => unwrap(api.get('/auth/me', opts)); // -> user
export const verifyEmail = (token) => unwrap(api.post('/auth/verify-email', { token }, open));
export const resendVerification = (email) => unwrap(api.post('/auth/resend-verification', { email }, open));
export const forgotPassword = (email) => unwrap(api.post('/auth/forgot-password', { email }, open));
export const resetPassword = (token, password) => unwrap(api.post('/auth/reset-password', { token, password }, open));
