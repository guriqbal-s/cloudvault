import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const handler = (_req, _res, next) => next(ApiError.tooMany());

/** Broad limiter applied to every /api route. */
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Login brute-force limiter: only FAILED attempts (status >= 400) count, so a user who signs
 * in correctly is never locked out by their own successful logins.
 */
export const loginLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});

/** Strict limiter for register, forgot/reset password and verification endpoints (all requests count). */
export const authLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
