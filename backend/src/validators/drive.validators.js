// Zod schemas for the drive endpoints (folders, files, versions, trash, starred, search).

import { z } from 'zod';
import { CATEGORIES } from '../utils/fileTypes.js';

const uuid = z.string().uuid('Invalid id');
const nullableUuid = z.union([uuid, z.null()]);
const name = z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(255, 'Name is too long');
const pagination = {
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};
const optionalString = (max) => z.string().trim().max(max).optional();

export const idParam = z.object({ id: uuid });
export const versionParam = z.object({ id: uuid, n: z.coerce.number().int().min(1).max(1_000_000) });
export const typedParam = z.object({ type: z.enum(['files', 'folders']), id: uuid });
export const typeParam = z.object({ type: z.enum(['files', 'folders']) });

export const listQuery = z.object({
  ...pagination,
  q: optionalString(100),
  type: z.enum(CATEGORIES).optional(),
  sort: z.enum(['name', 'size', 'createdAt', 'updatedAt', 'type']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const createFolderBody = z.object({ name, parentId: nullableUuid.optional() });
export const updateFolderBody = z
  .object({ name: name.optional(), parentId: nullableUuid.optional() })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, { message: 'Nothing to update' });

export const uploadBody = z.object({ folderId: z.preprocess((v) => (v === '' || v === 'null' ? null : v), nullableUuid.optional()) });
export const updateFileBody = z
  .object({ name: name.optional(), folderId: nullableUuid.optional() })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, { message: 'Nothing to update' });

export const accessUrlBody = z.object({ purpose: z.enum(['download', 'preview']) });
export const versionUploadBody = z.object({ comment: optionalString(500) });

export const recentQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const bytes = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const searchQuery = z.object({
  ...pagination,
  q: optionalString(100),
  type: z.enum(CATEGORIES).optional(),
  ownerId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minSize: bytes.optional(),
  maxSize: bytes.optional(),
});
