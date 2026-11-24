import { Router } from 'express';

import * as ctrl from '../controllers/auth.controller.js';
import { authenticate, trustedOrigin } from '../middleware/auth.js';
import { authLimiter, loginLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';
import {
  registerSchema, loginSchema, emailOnlySchema, verifyEmailSchema, resetPasswordSchema,
} from '../validators/auth.validators.js';

const router = Router();

// Public
router.post('/register', authLimiter, validate({ body: registerSchema }), ctrl.register);
router.post('/login', loginLimiter, validate({ body: loginSchema }), ctrl.login);
router.post('/verify-email', authLimiter, validate({ body: verifyEmailSchema }), ctrl.verifyEmail);
router.post('/resend-verification', authLimiter, validate({ body: emailOnlySchema }), ctrl.resendVerification);
router.post('/forgot-password', authLimiter, validate({ body: emailOnlySchema }), ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), ctrl.resetPassword);

// Cookie-authenticated: guarded against cross-origin browser requests
router.post('/refresh', trustedOrigin, ctrl.refresh);
router.post('/logout', trustedOrigin, ctrl.logout);

// Bearer-authenticated
router.get('/me', authenticate, ctrl.me);

export default router;
