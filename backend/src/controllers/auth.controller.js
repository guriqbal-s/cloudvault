// Thin HTTP adapters for /auth. All logic lives in services/auth/auth.logic.js.

import { env } from '../config/env.js';
import authService from '../services/auth/auth.service.js';
import { serializeUser } from '../services/auth/user.serializer.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from '../utils/refreshCookie.js';

const cookieOpts = { secure: env.auth.cookieSecure };
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, meta(req));
  const message = result.requiresVerification
    ? 'Account created. Check your email for a confirmation link.'
    : 'Account created. You can sign in now.';
  return created(res, result, { message });
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, meta(req));
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieOpts);
  return ok(res, { user: result.user, accessToken: result.accessToken }, { message: 'Signed in' });
});

export const refresh = asyncHandler(async (req, res) => {
  try {
    const result = await authService.refresh(readRefreshCookie(req), meta(req));
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieOpts);
    return ok(res, { user: result.user, accessToken: result.accessToken });
  } catch (err) {
    // Drop a dead cookie so the browser stops sending it. REFRESH_RACE is the exception: the
    // newer cookie from the winning request must survive.
    if (err instanceof ApiError && err.statusCode === 401 && err.code !== 'REFRESH_RACE') {
      clearRefreshCookie(res, cookieOpts);
    }
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(readRefreshCookie(req), meta(req));
  clearRefreshCookie(res, cookieOpts);
  return ok(res, null, { message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => ok(res, { user: serializeUser(req.user) }));

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);
  return ok(res, result, { message: result.alreadyVerified ? 'Email already verified' : 'Email verified. You can sign in now.' });
});

// The next three always answer 200 with the same text, whether or not the account exists.
export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body.email);
  return ok(res, null, { message: 'If that account is awaiting verification, a new email is on its way.' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  return ok(res, null, { message: 'If an account exists for that email, a reset link is on its way.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body, meta(req));
  clearRefreshCookie(res, cookieOpts); // every session was revoked
  return ok(res, null, { message: 'Password updated. Please sign in with your new password.' });
});
