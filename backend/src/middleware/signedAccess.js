// Authentication for file download/preview routes: a normal Bearer token, OR a short-lived
// `?st=` token minted by POST /files/:id/access-url (for <img>, <video>, <iframe>, plain links).
//
// A signed token is bound to one file and one purpose; the user is re-loaded so suspension and
// role changes apply immediately. Sets req.user (same shape as authenticate) and req.signed.

import ApiError from '../utils/ApiError.js';

/** @param {{ authenticate: Function, accessTokens: object, principals: { loadUser: Function } }} deps */
export function createAuthenticateOrSigned({ authenticate, accessTokens, principals }) {
  return function authenticateOrSigned(purpose) {
    return async (req, res, next) => {
      const st = req.query?.st;
      if (st === undefined) return authenticate(req, res, next);
      try {
        const claims = accessTokens.verify(String(st));
        if (claims.purpose !== purpose || claims.fileId !== req.params.id) {
          throw new ApiError(401, 'INVALID_ACCESS_URL', 'This link is invalid or has expired. Reload the page and try again.');
        }
        const principal = await principals.loadUser(claims.userId);
        if (principal.user.status === 'SUSPENDED') {
          throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact an administrator.');
        }
        req.user = { ...principal, sessionId: null };
        req.signed = claims;
        return next();
      } catch (err) {
        return next(err);
      }
    };
  };
}
