// Short-lived access JWTs. The library is injected (jsonwebtoken in production) so the
// security-relevant options are visible here and testable.
//
// Claims: sub = user id, sid = session id (lets the server revoke an access token instantly
// by revoking the session), iss = "cloudvault". The algorithm is pinned on both sign and verify
// so a token cannot downgrade to "none" or be re-signed with a different algorithm.

import ApiError from '../../utils/ApiError.js';

const ALGORITHM = 'HS256';

export function createTokenService({ jwt, secret, expiresIn, issuer = 'cloudvault' }) {
  if (!secret || secret.length < 16) throw new Error('JWT secret is missing or too short');

  return {
    signAccess({ userId, sessionId }) {
      return jwt.sign({ sid: sessionId }, secret, {
        algorithm: ALGORITHM,
        subject: userId,
        issuer,
        expiresIn,
      });
    },

    /** @returns {{ userId: string, sessionId: string }} @throws ApiError 401 */
    verifyAccess(token) {
      let payload;
      try {
        payload = jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer });
      } catch (err) {
        if (err?.name === 'TokenExpiredError') {
          throw ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
        }
        throw ApiError.unauthorized('Invalid access token', 'INVALID_TOKEN');
      }
      if (!payload || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw ApiError.unauthorized('Invalid access token', 'INVALID_TOKEN');
      }
      return { userId: payload.sub, sessionId: payload.sid };
    },
  };
}
