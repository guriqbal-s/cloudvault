// Bearer-token authentication. A factory so it can be tested with stubs; middleware/auth.js
// wires the real token service and principal loader.
//
// On success it sets req.user = { user, roles, permissions: Set, rank, sessionId }.
// Error codes the SPA relies on: TOKEN_EXPIRED (silently refresh and retry), SESSION_REVOKED /
// INVALID_TOKEN (sign out), ACCOUNT_SUSPENDED (show the suspension message).

import ApiError from '../utils/ApiError.js';

const BEARER = /^Bearer\s+(\S+)$/i;

export function createAuthenticate({ tokens, principals }) {
  return async function authenticate(req, _res, next) {
    try {
      const match = BEARER.exec(req.headers.authorization ?? '');
      if (!match) throw ApiError.unauthorized('Authentication required');

      const { userId, sessionId } = tokens.verifyAccess(match[1]);
      req.user = await principals.authenticate({ userId, sessionId });
      next();
    } catch (err) {
      next(err);
    }
  };
}
