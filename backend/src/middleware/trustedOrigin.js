// CSRF defence in depth for the endpoints that rely on the refresh cookie (refresh, logout).
// The cookie is already SameSite=Strict; this also rejects any browser request whose Origin is
// not the configured web app. Requests with no Origin header (curl, server-to-server) pass, since
// browsers always send Origin on cross-site POSTs.

import ApiError from '../utils/ApiError.js';

export function createTrustedOrigin(allowedOrigin) {
  return function trustedOrigin(req, _res, next) {
    const origin = req.headers.origin;
    if (!origin || origin === allowedOrigin) return next();
    return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
  };
}
