// Production wiring of the signed-URL middleware.
import { principalLoader } from '../services/auth/auth.service.js';
import { accessTokens } from '../services/drive/drive.service.js';
import { authenticate } from './auth.js';
import { createAuthenticateOrSigned } from './signedAccess.js';

export const authenticateOrSigned = createAuthenticateOrSigned({ authenticate, accessTokens, principals: principalLoader });
