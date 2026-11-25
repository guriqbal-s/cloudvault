# Database schema

Prisma models live in `prisma/schema.prisma`. The initial MySQL migration defines additional database constraints.

| Model | Purpose |
|---|---|
| User | account, status (PENDING/ACTIVE/SUSPENDED), quota, theme, notificationPrefs, avatar |
| Role / Permission / RolePermission / UserRole | RBAC: 5 roles (with `rank`), 27 permissions grouped by area |
| UserSession / RefreshToken | device sessions and rotating refresh tokens (hash only, family id for reuse detection) |
| PasswordResetToken / EmailVerificationToken | single-use hashed tokens |
| Folder | tree via `parentId` plus materialised `path` ("/id/id/"); soft delete (`deletedAt`) |
| File / FileVersion | file row points to its current version; every version stores size, storage key, uploader, comment |
| FileShare / FolderShare | per-user shares: role (VIEWER/EDITOR), `canDownload` |
| ShareLink | token, expiry, optional `passwordHash`, `canDownload`, access count |
| StarredResource | per-user stars for files and folders |
| Notification | typed, per-user, `readAt` |
| ActivityLog | audit trail with description, resource reference, IP |
| StorageUsage | daily per-user snapshots used by charts |

## Constraints and indexes

- Unique indexes enforce case-insensitive sibling names for live files and folders. Trashed items can reuse names.
- CHECK constraints enforce non-negative sizes and quotas, positive version numbers, valid share targets, and no self-sharing.
- The prefix index on folder paths supports subtree lookup. Name search uses MySQL case-insensitive substring matching.

## Seed
`npm run db:seed`: 5 roles and 27 permissions only, no users or files. Create the Super Admin and Admin accounts with [database/create-admins.sql](../database/create-admins.sql).
