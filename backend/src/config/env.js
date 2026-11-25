// Single source of truth for configuration. Loads <repo>/.env, validates it with Zod and
// exports a frozen, typed-by-convention object. The process refuses to start on bad config.

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { cloudinaryCredentials, isPlaceholder } from '../services/storage/cloudinaryConfig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

// Blank values in .env ("SMTP_HOST=") are treated as "not set" so defaults apply.
const blankToUndefined = (v) => (v === '' || v === null ? undefined : v);
const str = (def = '') => z.preprocess(blankToUndefined, z.string().default(def));
const int = (def, { min = 0 } = {}) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).default(def));
const bool = (def) =>
  z
    .preprocess(blankToUndefined, z.enum(['true', 'false']).default(def ? 'true' : 'false'))
    .transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, { min: 1 }),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    // How many reverse proxies sit in front of the API: false/0 = none, true = 1, or a number
    // (e.g. 2 for Caddy -> nginx -> api). Decides which X-Forwarded-For entry is the client IP.
    TRUST_PROXY: z
      .preprocess(blankToUndefined, z.string().regex(/^(true|false|\d+)$/, 'must be true, false or a number of proxy hops').default('false'))
      .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v))),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    // Optional. Set to run more than one API instance (shared rate limits, sockets, job locks).
    REDIS_URL: z.preprocess(blankToUndefined, z.string().regex(/^rediss?:\/\//, 'must start with redis:// or rediss://').optional()),

    JWT_ACCESS_SECRET: z.string().min(16, 'must be at least 16 characters'),
    JWT_ACCESS_EXPIRES: str('15m'),
    REFRESH_TOKEN_DAYS: int(30, { min: 1 }),
    COOKIE_SECURE: bool(false),
    BCRYPT_ROUNDS: int(12, { min: 4 }),
    REQUIRE_EMAIL_VERIFICATION: bool(true),
    PASSWORD_RESET_MINUTES: int(60, { min: 1 }),
    EMAIL_VERIFICATION_HOURS: int(24, { min: 1 }),

    STORAGE_DRIVER: z.enum(['local', 'cloudinary', 's3']).default('local'),
    STORAGE_ROOT: str('./storage'),
    // Either CLOUDINARY_URL (cloudinary://KEY:SECRET@CLOUD_NAME) or the three separate values.
    CLOUDINARY_URL: str(''),
    CLOUDINARY_CLOUD_NAME: str(''),
    CLOUDINARY_API_KEY: str(''),
    CLOUDINARY_API_SECRET: str(''),
    CLOUDINARY_FOLDER: str('cloudvault'),
    MAX_UPLOAD_BYTES: int(104857600, { min: 1 }),
    DEFAULT_QUOTA_BYTES: int(5368709120),
    QUOTA_WARNING_PERCENT: int(80, { min: 1 }),
    ALLOWED_EXTENSIONS: str('pdf,doc,docx,xls,xlsx,ppt,pptx,txt,jpg,jpeg,png,gif,mp4,zip,csv'),

    TRASH_RETENTION_DAYS: int(30, { min: 1 }),
    TRASH_PURGE_CRON: str('0 3 * * *'),
    LINK_EXPIRY_CRON: str('*/30 * * * *'),
    STORAGE_SNAPSHOT_CRON: str('5 0 * * *'),

    RATE_LIMIT_WINDOW_MS: int(900000, { min: 1000 }),
    RATE_LIMIT_MAX: int(300, { min: 1 }),
    AUTH_RATE_LIMIT_MAX: int(20, { min: 1 }),

    SMTP_HOST: str(''),
    SMTP_PORT: int(587, { min: 1 }),
    SMTP_SECURE: bool(false),
    SMTP_USER: str(''),
    SMTP_PASS: str(''),
    MAIL_FROM: str('CloudVault <no-reply@cloudvault.local>'),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === 'cloudinary') {
      const c = cloudinaryCredentials(v);
      for (const [field, value] of [['CLOUDINARY_CLOUD_NAME', c.cloudName], ['CLOUDINARY_API_KEY', c.apiKey], ['CLOUDINARY_API_SECRET', c.apiSecret]]) {
        if (isPlaceholder(value)) {
          ctx.addIssue({ code: 'custom', path: [field], message: 'required when STORAGE_DRIVER=cloudinary (or set CLOUDINARY_URL)' });
        }
      }
    }
    if (v.STORAGE_DRIVER === 's3') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 's3 is not implemented yet; use cloudinary or local' });
    }
    if (v.NODE_ENV !== 'production') return;

    // Production refuses to start on settings that would silently break security or core flows.
    const issue = (field, message) => ctx.addIssue({ code: 'custom', path: [field], message });
    if (v.JWT_ACCESS_SECRET.startsWith('change-me') || v.JWT_ACCESS_SECRET.length < 32) {
      issue('JWT_ACCESS_SECRET', 'production requires a random secret of 32+ characters (openssl rand -hex 64)');
    }
    if (!v.COOKIE_SECURE) issue('COOKIE_SECURE', 'must be true in production (HTTPS only cookies)');
    if (!v.CLIENT_URL.startsWith('https://')) issue('CLIENT_URL', 'must be the https:// address of the app in production');
    if (!v.SMTP_HOST) {
      issue('SMTP_HOST', 'production needs real email delivery: without it, sign-up verification and password reset links are never sent');
    }
    if (v.MAIL_FROM.includes('.local>')) issue('MAIL_FROM', 'set a sender address on a domain your SMTP provider has verified');
    if (v.BCRYPT_ROUNDS < 10) issue('BCRYPT_ROUNDS', 'must be at least 10 in production');
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nCheck .env (see .env.example).`);
}
const e = parsed.data;

const storageRoot = path.resolve(REPO_ROOT, e.STORAGE_ROOT);

export const env = Object.freeze({
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  port: e.PORT,
  clientUrl: e.CLIENT_URL.replace(/\/$/, ''),
  trustProxy: e.TRUST_PROXY,
  databaseUrl: e.DATABASE_URL,
  redisUrl: e.REDIS_URL ?? '',

  auth: Object.freeze({
    accessSecret: e.JWT_ACCESS_SECRET,
    accessExpires: e.JWT_ACCESS_EXPIRES,
    refreshTokenDays: e.REFRESH_TOKEN_DAYS,
    cookieSecure: e.COOKIE_SECURE,
    bcryptRounds: e.BCRYPT_ROUNDS,
    requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION,
    passwordResetMinutes: e.PASSWORD_RESET_MINUTES,
    emailVerificationHours: e.EMAIL_VERIFICATION_HOURS,
  }),

  storage: Object.freeze({
    driver: e.STORAGE_DRIVER,
    root: storageRoot,
    tmpDir: path.join(storageRoot, 'tmp'), // multer staging area (driver independent)
    cloudinary: Object.freeze({ ...cloudinaryCredentials(e), folder: e.CLOUDINARY_FOLDER }),
    maxUploadBytes: e.MAX_UPLOAD_BYTES,
    defaultQuotaBytes: BigInt(e.DEFAULT_QUOTA_BYTES),
    quotaWarningPercent: e.QUOTA_WARNING_PERCENT,
    allowedExtensions: Object.freeze(
      e.ALLOWED_EXTENSIONS.split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    ),
  }),

  jobs: Object.freeze({
    trashRetentionDays: e.TRASH_RETENTION_DAYS,
    trashPurgeCron: e.TRASH_PURGE_CRON,
    linkExpiryCron: e.LINK_EXPIRY_CRON,
    storageSnapshotCron: e.STORAGE_SNAPSHOT_CRON,
  }),

  rateLimit: Object.freeze({
    windowMs: e.RATE_LIMIT_WINDOW_MS,
    max: e.RATE_LIMIT_MAX,
    authMax: e.AUTH_RATE_LIMIT_MAX,
  }),

  smtp: Object.freeze({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    user: e.SMTP_USER,
    pass: e.SMTP_PASS,
  }),
  mailFrom: e.MAIL_FROM,
});
