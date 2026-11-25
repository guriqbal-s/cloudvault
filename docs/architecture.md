# CloudVault architecture

## Overview
```
 Browser (React SPA, Vite :5173) ──/api, /socket.io proxy──▶ Express API (:4000) ──▶ MySQL (Prisma)
        │  access JWT in memory                               │  └─▶ StorageProvider (local disk ./storage)
        └─ refresh cookie cv_rt (httpOnly, /api/v1/auth)      └─▶ Socket.IO (notification:new), node-cron jobs
```
Monorepo (npm workspaces): `backend`, `frontend`; `prisma/` holds schema, SQL extras and seed; `storage/` holds blobs.

## Backend layering
`routes → validators (Zod) → controllers → *.service.js (wiring) → *.logic.js (factories, injected deps) → Prisma / storage`.
Logic factories receive `db`, `storage`, `clock`, `hasher`, `mailer`, so they run in unit tests with in-memory fakes.
Only `*.service.js`, repositories (`drive.repo.js`), controllers, routes and validators touch real libraries.

## Security model
- **Authentication**: 15-minute HS256 access JWT (algorithm pinned) plus rotating refresh token (64 random bytes, only the SHA-256 stored, reuse detection revokes the session family). Passwords are bcrypt-hashed. Login is timing-equalised and rate limited.
- **Authorization, two layers**: (1) RBAC permission keys via `requirePermission`; (2) resource ACL in `access.logic.js` (owner, direct share, inherited folder share, share link). The effective right is the more restrictive of the two. Invisible resources return 404, visible-but-forbidden return 403.
- **Ownership invariant**: everything created inside a folder belongs to that folder's owner; no cross-owner moves; admins have no automatic access to content.
- **Files**: extension allow-list, size limit, quota (counts all versions and trash), `nosniff`, safe `Content-Disposition`, range requests. Browser-embedded media uses 60-second signed `?st=` URLs bound to one user, file and purpose.
- **Public links**: unguessable token, optional expiry, optional password (bcrypt) exchanged for a 15-minute HMAC unlock token.
- Helmet, CORS allow-list, `trustedOrigin` check on cookie endpoints, Zod validation everywhere, uniform error envelope.

## Storage
`StorageProvider` interface (`put`, `putFromFile`, `getStream` with range, `exists`, `getSize`, `delete`, `deletePrefix`, `copy`, `healthCheck`, `getDownloadTarget`). Keys: `versions/users/<ownerId>/<fileId>/v<n>`, `uploads/avatars/<userId>`. To move to S3, implement the interface and set `STORAGE_DRIVER`; `getDownloadTarget` can then return a redirect to a pre-signed URL. RDS only needs a new `DATABASE_URL`.

## Realtime and jobs
Socket.IO authenticates `auth.token`, joins room `user:<id>`, and emits `notification:new {notification, unreadCount}`. `startJobs()` schedules: trash purge (retention days), expired link cleanup, token pruning, storage-quota warnings, daily storage snapshot.

## Frontend
React 18, React Router 6 (lazy routes, guards), Axios client with single-flight refresh, contexts (Auth, Theme, Toast, Notification/socket), Tailwind with CSS-variable tokens for light/dark, UI kit in `components/ui`, feature components in `components/{drive,dashboard,admin,settings}`. See `frontend-guide.md`.

## Testing
`npm test` (248 `node:test` tests) covers logic layers with in-memory fakes. The HTTP wiring, Prisma queries, Multer, Socket.IO and the whole frontend have **not been executed** in the build environment (no network, no packages). First run with real dependencies is the integration test; see README "First run checklist".
