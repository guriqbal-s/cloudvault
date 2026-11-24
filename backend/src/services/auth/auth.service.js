// Production wiring for authentication: real Prisma, bcrypt, jsonwebtoken and Nodemailer.
// Import { authService, tokenService, principalLoader } from here; tests use the *.logic factories.

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import prisma from '../../config/db.js';
import { env } from '../../config/env.js';
import { sendMail } from '../../config/mail.js';
import logger from '../../utils/logger.js';
import activityService from '../activity.service.js';
import { createAuthService } from './auth.logic.js';
import { createPrincipalLoader } from './principal.js';
import { createTokenService } from './tokens.js';
import { verifyEmailMail, resetPasswordMail, passwordChangedMail } from './auth.mail.js';

export const tokenService = createTokenService({
  jwt,
  secret: env.auth.accessSecret,
  expiresIn: env.auth.accessExpires,
});

export const principalLoader = createPrincipalLoader({
  db: prisma,
  requireEmailVerification: env.auth.requireEmailVerification,
});

export const authService = createAuthService({
  db: prisma,
  hasher: {
    hash: (plain) => bcrypt.hash(plain, env.auth.bcryptRounds),
    compare: (plain, hash) => bcrypt.compare(plain, hash),
  },
  tokens: tokenService,
  principals: principalLoader,
  mailer: { sendMail },
  templates: { verifyEmail: verifyEmailMail, resetPassword: resetPasswordMail, passwordChanged: passwordChangedMail },
  activity: activityService,
  config: {
    refreshTokenDays: env.auth.refreshTokenDays,
    requireEmailVerification: env.auth.requireEmailVerification,
    passwordResetMinutes: env.auth.passwordResetMinutes,
    emailVerificationHours: env.auth.emailVerificationHours,
    clientUrl: env.clientUrl,
    defaultQuotaBytes: env.storage.defaultQuotaBytes,
  },
  logger,
});

export default authService;
