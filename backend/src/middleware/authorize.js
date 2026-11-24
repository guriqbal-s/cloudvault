// Global RBAC ("layer 1"): does the signed-in user's role include a permission key?
// Resource-level checks (owner / shared with me) are layer 2 and live in services/access.logic.js.
// Always mount AFTER authenticate.
//
//   router.post('/upload', authenticate, requirePermission('file:upload'), ...)

import ApiError from '../utils/ApiError.js';

function assertKeys(keys) {
  if (keys.length === 0 || keys.some((k) => typeof k !== 'string' || !k)) {
    // A typo here would silently deny everyone; fail at startup instead.
    throw new TypeError('requirePermission needs one or more permission key strings');
  }
}

const deny = () => ApiError.forbidden('Your role does not allow this action');

/** The user must hold ALL of the given permissions. */
export function requirePermission(...keys) {
  assertKeys(keys);
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    return keys.every((k) => req.user.permissions.has(k)) ? next() : next(deny());
  };
}

/** The user must hold AT LEAST ONE of the given permissions. */
export function requireAnyPermission(...keys) {
  assertKeys(keys);
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    return keys.some((k) => req.user.permissions.has(k)) ? next() : next(deny());
  };
}
