import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import ApiError from '../utils/ApiError.js';

const handler = (_req, _res, next) => next(ApiError.tooMany());

// With Redis, counters are shared by every API instance; otherwise they live in this process.
const store = (name) =>
  redis ? new RedisStore({ prefix: `cv:rl:${name}:`, sendCommand: (command, ...args) => redis.call(command, ...args) }) : undefined;

/** Broad limiter applied to every /api route. */
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  store: store('api'),
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
  store: store('login'),
});

/** Strict limiter for register, forgot/reset password and verification endpoints (all requests count). */
export const authLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  store: store('auth'),
});
