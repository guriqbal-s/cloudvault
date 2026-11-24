// The refresh token travels ONLY in this cookie: httpOnly (JavaScript cannot read it),
// SameSite=Strict (never sent on cross-site requests), and scoped to the auth endpoints.
// The access token is the opposite: held in memory by the SPA and sent in a header.

import { AUTH_COOKIE_PATH, REFRESH_COOKIE_NAME } from '../config/constants.js';

const base = ({ secure }) => ({
  httpOnly: true,
  secure: Boolean(secure),
  sameSite: 'strict',
  path: AUTH_COOKIE_PATH,
});

export function setRefreshCookie(res, token, expiresAt, { secure }) {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...base({ secure }), expires: expiresAt });
}

export function clearRefreshCookie(res, { secure }) {
  // Must repeat the same path/flags or the browser keeps the original cookie.
  res.clearCookie(REFRESH_COOKIE_NAME, base({ secure }));
}

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
}
