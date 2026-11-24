// Zod schemas for the auth and session endpoints. Used through middleware/validate.js, which
// replaces req.body / req.params with the parsed (trimmed, lower-cased) values.

import { z } from 'zod';

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254, 'Email is too long');

// bcrypt only uses the first 72 BYTES of its input, so longer passwords would be silently
// truncated. Limit by byte length (not characters) so multi-byte characters are counted.
export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long (72 bytes maximum)')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

// Tokens are 32-64 random bytes encoded as base64url.
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'Invalid token');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(128),
});

export const emailOnlySchema = z.object({ email: emailSchema });

export const verifyEmailSchema = z.object({ token: tokenSchema });

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Current password is required' }).min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
