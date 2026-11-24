// Production wiring of the auth middleware. Routes import from here:
//   import { authenticate, trustedOrigin } from '../middleware/auth.js';
//   import { requirePermission } from '../middleware/authorize.js';

import { env } from '../config/env.js';
import { principalLoader, tokenService } from '../services/auth/auth.service.js';
import { createAuthenticate } from './authenticate.js';
import { createTrustedOrigin } from './trustedOrigin.js';

export const authenticate = createAuthenticate({ tokens: tokenService, principals: principalLoader });
export const trustedOrigin = createTrustedOrigin(env.clientUrl);
