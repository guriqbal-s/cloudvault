# Database schema

Defined in `prisma/schema.prisma`; extra DDL in `prisma/extras.sql` is appended to the init migration by `npm run db:setup`.

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

## Constraints and indexes (extras.sql)
- `pg_trgm` GIN indexes for fuzzy name search.
- Partial unique indexes on live sibling names (case-insensitive), so trashed items do not block name reuse.
- CHECK constraints (non-negative sizes and quotas, positive version numbers).
- `text_pattern_ops` index on `Folder.path` for subtree queries (move, cascade delete).

## Demo seed
`npm run db:seed`: 5 roles, 27 permissions, accounts `superadmin|admin|manager|alice|bob|viewer|suspended|pending@cloudvault.dev`, password `CloudVault#2026`, sample folders, files, shares and activity.
