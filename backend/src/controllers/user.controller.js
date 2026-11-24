// /users/me/* endpoints: profile, preferences, avatar, user lookup, password change, sessions.

import { env } from '../config/env.js';
import authService, { principalLoader } from '../services/auth/auth.service.js';
import { serializeUser } from '../services/auth/user.serializer.js';
import { profileService } from '../services/social.service.js';
import { actorOf } from '../utils/actor.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { clearRefreshCookie } from '../utils/refreshCookie.js';

const cookieOpts = { secure: env.auth.cookieSecure };
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.user.id, req.user.sessionId, req.body, meta(req));
  return ok(res, null, { message: 'Password changed. Your other devices were signed out.' });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions(req.user.user.id, req.user.sessionId);
  return ok(res, { sessions });
});

export const revokeSession = asyncHandler(async (req, res) => {
  const result = await authService.revokeSession(req.user.user.id, req.params.id, req.user.sessionId);
  if (result.revokedCurrent) clearRefreshCookie(res, cookieOpts);
  return ok(res, result, { message: 'Session signed out' });
});

export const revokeOtherSessions = asyncHandler(async (req, res) => {
  const result = await authService.revokeOtherSessions(req.user.user.id, req.user.sessionId);
  return ok(res, result, { message: 'Signed out of all other devices' });
});

// ---- profile, preferences, avatar, lookup ------------------------------------------------------
const currentUser = async (req) => serializeUser(await principalLoader.loadUser(req.user.user.id));

export const me = asyncHandler(async (req, res) => ok(res, { user: await currentUser(req) }));

export const updateProfile = asyncHandler(async (req, res) => {
  await profileService.updateProfile(req.user.user.id, req.body, meta(req));
  return ok(res, { user: await currentUser(req) }, { message: 'Profile updated' });
});

export const updatePreferences = asyncHandler(async (req, res) => {
  await profileService.updatePreferences(req.user.user.id, req.body, meta(req));
  return ok(res, { user: await currentUser(req) }, { message: 'Preferences saved' });
});

export const setAvatar = asyncHandler(async (req, res) => {
  await profileService.setAvatar(req.user.user.id, req.file?.buffer, meta(req));
  return ok(res, { user: await currentUser(req) }, { message: 'Profile picture updated' });
});

export const removeAvatar = asyncHandler(async (req, res) => {
  await profileService.removeAvatar(req.user.user.id, meta(req));
  return ok(res, { user: await currentUser(req) }, { message: 'Profile picture removed' });
});

/** Fetch with the Authorization header (axios blob), not through <img src>. */
export const avatar = asyncHandler(async (req, res) => {
  const userId = !req.params.id || req.params.id === 'me' ? req.user.user.id : req.params.id;
  const { buffer, mimeType } = await profileService.getAvatar(userId);
  res.set({ 'Content-Type': mimeType, 'Content-Length': String(buffer.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' });
  return res.status(200).end(buffer);
});

export const lookup = asyncHandler(async (req, res) => ok(res, { users: await profileService.lookup(actorOf(req), req.query.q) }));
