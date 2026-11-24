// Zod schemas for sharing, links, notifications, activity, dashboard, admin and profile endpoints.

import { z } from 'zod';
import { ACTIVITY_ACTIONS } from '../constants/activityActions.js';
import { emailSchema, passwordSchema } from './auth.validators.js';

const uuid = z.string().uuid('Invalid id');
const page = z.coerce.number().int().min(1).max(100000).optional();
const limit = z.coerce.number().int().min(1).max(100).optional();
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** ISO date-time or YYYY-MM-DD. A date-only `to` means the end of that day. */
const dateParam = (endOfDay = false) =>
  z.string().trim().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date').transform((s) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) && endOfDay ? `${s}T23:59:59.999Z` : s));

const isoDate = z.string().datetime({ offset: true, message: 'Use an ISO 8601 date-time' }).transform((s) => new Date(s));
const linkPassword = z.string().min(4, 'Password must be at least 4 characters').max(72, 'Password is too long')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long (72 bytes maximum)');
const name = z.string({ required_error: 'Name is required' }).trim().min(2, 'Name must be at least 2 characters').max(80, 'Name must be at most 80 characters');

// ---- sharing -------------------------------------------------------------------------------
export const targetParam = z.object({ type: z.enum(['files', 'folders']), id: uuid });
export const shareUserParam = targetParam.extend({ userId: uuid });
export const grantBody = z.object({ email: emailSchema, level: z.enum(['VIEWER', 'EDITOR']), canDownload: z.boolean().optional() });
export const updateShareBody = z
  .object({ level: z.enum(['VIEWER', 'EDITOR']).optional(), canDownload: z.boolean().optional() })
  .refine((v) => v.level !== undefined || v.canDownload !== undefined, { message: 'Nothing to update' });

export const linkIdParam = z.object({ linkId: uuid });
export const createLinkBody = z.object({
  expiresAt: z.union([z.null(), isoDate]).optional(),
  password: linkPassword.optional(),
  canDownload: z.boolean().optional(),
});
export const updateLinkBody = z
  .object({
    expiresAt: z.union([z.null(), isoDate]).optional(),
    password: z.union([z.null(), linkPassword]).optional(),
    canDownload: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });

// ---- public links ----------------------------------------------------------------------------
const token = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Invalid link');
export const publicTokenParam = z.object({ token });
export const publicFileParam = z.object({ token, fileId: uuid });
export const publicQuery = z.object({ at: z.string().max(1024).optional(), folderId: uuid.optional() });
export const unlockBody = z.object({ password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(128) });

// ---- notifications / activity ------------------------------------------------------------------
export const idParam = z.object({ id: uuid });
export const notificationsQuery = z.object({ page, limit, unread: bool.optional() });
export const activityQuery = z.object({
  page, limit,
  action: z.enum(ACTIVITY_ACTIONS).optional(),
  from: dateParam().optional(),
  to: dateParam(true).optional(),
});
export const adminActivityQuery = activityQuery.extend({ userId: uuid.optional(), q: z.string().trim().max(100).optional() });

// ---- admin -----------------------------------------------------------------------------------
export const adminUsersQuery = z.object({
  page, limit,
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION']).optional(),
  role: z.string().trim().max(60).optional(),
  sort: z.string().max(40).optional(),
});
const quota = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const createUserBody = z.object({
  name, email: emailSchema, password: passwordSchema,
  roleKey: z.string().trim().min(1).max(60).optional(),
  quotaBytes: quota.optional(),
});
export const updateUserBody = z
  .object({ name: name.optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), quotaBytes: quota.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export const rolesBody = z.object({ roleKeys: z.array(z.string().trim().min(1).max(60)).min(1, 'Choose at least one role').max(5) });
export const deleteUserQuery = z.object({ purge: bool.optional() });
export const rankingQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() });
export const pagingQuery = z.object({ page, limit });

// ---- profile ---------------------------------------------------------------------------------
export const updateProfileBody = z.object({ name });
const prefGroup = z.object({ shared: z.boolean().optional(), uploads: z.boolean().optional(), quota: z.boolean().optional() }).strict();
export const preferencesBody = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    notificationPrefs: z.object({ inApp: prefGroup.optional(), email: prefGroup.optional() }).strict().optional(),
  })
  .refine((v) => v.theme !== undefined || v.notificationPrefs !== undefined, { message: 'Nothing to update' });
export const lookupQuery = z.object({ q: z.string().trim().max(100).optional() });
