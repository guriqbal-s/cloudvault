# CloudVault API contract (v1)

Base: `/api/v1`. Envelope: `{success:true,data,message?,meta?}` / `{success:false,error:{code,message,details?}}`.
Auth: `Authorization: Bearer <access JWT>` unless marked **public**. Lists accept `?page=&limit=&sort=&order=` and return `meta:{page,limit,total,totalPages}`.
BigInt sizes are serialised as numbers. Dates are ISO strings.
Status rules: 404 when the resource is invisible to the actor, 403 when visible but not allowed, 422 validation, 409 name conflict / quota is 413 `QUOTA_EXCEEDED`.

## Shapes (see `services/dto.js`)
- **File**: id, kind:'file', name, extension, mimeType, category, size, ownerId, owner{id,name}, folderId, createdAt, updatedAt, lastAccessedAt, deletedAt, starred, shared, versionCount, currentVersion, sharedBy?, access{level,canDownload,source,capabilities{read,download,update,version,createChild,delete,share}}
- **Folder**: id, kind:'folder', name, ownerId, owner, parentId, createdAt, updatedAt, deletedAt, starred, shared, itemCount, sharedBy?, access
- **Notification**: id,type,title,body,data,readAt,createdAt
- **Activity**: id,action,description,resourceType,resourceId,resourceName,user{id,name},ip,createdAt

## Folders (`/folders`)
| Method | Path | Notes |
|---|---|---|
| GET | `/folders/root` | `{folder:null, breadcrumbs:[], folders:[], files:[]}` for the caller's root; query `q,sort,order,type,page,limit` apply to files |
| GET | `/folders/:id` | `{folder, breadcrumbs:[{id,name}], folders:[], files:[]}` |
| POST | `/folders` | `{name, parentId?}` -> folder (201) |
| PATCH | `/folders/:id` | `{name?, parentId?}` rename/move (same owner only) |
| DELETE | `/folders/:id` | soft delete (to trash), cascades to contents |
| GET | `/folders/:id/download` | zip not required; 501 `NOT_IMPLEMENTED` is acceptable |

## Files (`/files`)
| Method | Path | Notes |
|---|---|---|
| POST | `/files/upload` | multipart: `files` (1..N), `folderId?`. Returns `{results:[{name, ok, file?|error{code,message}}]}`; duplicate names auto-rename `name (1).ext`; each file checked for extension allow-list, size limit, quota |
| GET | `/files/:id` | file DTO + `versions` count |
| PATCH | `/files/:id` | `{name?, folderId?}` rename/move |
| DELETE | `/files/:id` | soft delete |
| GET | `/files/:id/download` | stream, attachment; Bearer or `?st=` signed token |
| GET | `/files/:id/preview` | stream, inline (only previewable kinds; else 415) |
| POST | `/files/:id/access-url` | `{purpose:'download'|'preview'}` -> `{url, expiresAt}` (`?st=` 60s token) for `<img>/<video>/<iframe>` |
| GET | `/files/:id/versions` | versions list (number, size, uploadedBy, createdAt, comment, isCurrent) |
| POST | `/files/:id/versions` | multipart `file`, `comment?` -> new version |
| POST | `/files/:id/versions/:n/restore` | creates a new version copied from n |
| GET | `/files/:id/versions/:n/download` | stream |
| DELETE | `/files/:id/versions/:n` | not allowed on current version |

## Trash / Starred / Recent / Search / Storage
| Method | Path | Notes |
|---|---|---|
| GET | `/trash` | `{folders, files}` top-level trashed items owned by caller |
| POST | `/trash/:type/:id/restore` | type = `files`\|`folders` |
| DELETE | `/trash/:type/:id` | permanent delete (frees quota, deletes blobs) |
| DELETE | `/trash` | empty trash |
| GET | `/starred` | `{folders, files}` |
| PUT | `/starred/:type/:id` | star (idempotent) |
| DELETE | `/starred/:type/:id` | unstar |
| GET | `/recent` | files, `?limit=` (default 20), ordered by last access/update |
| GET | `/search` | `q, type(category), ownerId?, from?, to?, minSize?, maxSize?, page, limit` -> `{folders, files}` meta on files |
| GET | `/storage` | `{used, quota, percent, breakdown:[{category,label,bytes,count}], trashBytes}` |

## Sharing
| Method | Path | Notes |
|---|---|---|
| GET | `/shares/with-me` | `{folders, files}` with `sharedBy` and `access` |
| GET | `/shares/by-me` | `{folders, files}` the caller has shared |
| GET | `/shares/:type/:id` | `{people:[{id,user{id,name,email},level,canDownload,createdAt}], links:[...]}`; needs `share` capability |
| POST | `/shares/:type/:id` | `{email, level:'VIEWER'|'EDITOR', canDownload?}` upsert; notifies recipient |
| PATCH | `/shares/:type/:id/:userId` | `{level?, canDownload?}` |
| DELETE | `/shares/:type/:id/:userId` | revoke; notifies |
| POST | `/share-links/:type/:id` | `{expiresAt?, password?, canDownload?}` -> link incl. `token` (shown once) and `url` |
| PATCH | `/share-links/:linkId` | `{expiresAt?, password?|null, canDownload?, active?}` |
| DELETE | `/share-links/:linkId` | revoke |
| GET | `/public/links/:token` | **public** metadata `{name, kind, size?, requiresPassword, expired}` |
| POST | `/public/links/:token/unlock` | **public** `{password}` -> `{accessToken}` (short-lived) |
| GET | `/public/links/:token/download` | **public** stream (`?at=` unlock token when password-protected) |
| GET | `/public/links/:token/preview` | **public** inline |

## Notifications / Activity / Dashboard
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | `?unread=true&page&limit`, meta includes `unreadCount` |
| POST | `/notifications/read-all` | |
| PATCH | `/notifications/:id/read` | |
| DELETE | `/notifications/:id` | |
| GET | `/activity` | caller's own activity; `?action=&from=&to=` |
| GET | `/dashboard` | `{storage:{used,quota,percent}, counts:{files,folders,shared,starred,trash}, byCategory:[{category,label,bytes,count}], uploadsOverTime:[{date,count,bytes}] (30d), recentFiles:[], recentActivity:[]}` |

## Profile (`/users`, extends the existing routes)
| Method | Path | Notes |
|---|---|---|
| GET | `/users/me` | auth user (see auth contract) |
| PATCH | `/users/me` | `{name?}` |
| PATCH | `/users/me/preferences` | `{theme?:'light'|'dark'|'system', notificationPrefs?}` |
| POST | `/users/me/avatar` | multipart `avatar` (png/jpg/gif <=2MB) |
| GET | `/users/:id/avatar` | image stream (authenticated users) |
| DELETE | `/users/me/avatar` | |
| GET | `/users/lookup?q=` | share-dialog autocomplete: `[{id,name,email}]` (max 8, active users, excludes self) |
| existing | `PATCH /users/me/password`, `/users/me/sessions` | unchanged (password route is `/me/password`) |

## Admin (`/admin`, permission-gated)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | users, files, storage, active sessions, signups over time |
| GET | `/admin/users` | `?q,status,role,page,limit,sort` |
| POST | `/admin/users` | create user `{name,email,password,roleKey,quotaBytes?}` |
| GET | `/admin/users/:id` | |
| PATCH | `/admin/users/:id` | `{name?, status?, quotaBytes?}`; cannot suspend yourself |
| PUT | `/admin/users/:id/roles` | `{roleKeys:[...]}`; role rank rules: cannot grant/alter a role ranked at or above own, cannot demote last Super Admin |
| DELETE | `/admin/users/:id` | soft/permanent per permission; cannot delete yourself or last Super Admin |
| POST | `/admin/users/:id/revoke-sessions` | |
| GET | `/admin/roles` | roles with permission keys + user counts |
| GET | `/admin/activity` | all activity, filters `userId,action,from,to,q` |
| GET | `/admin/storage` | per-user usage ranking and totals |

## Realtime (Socket.IO, same origin, path `/socket.io`)
Client connects with `auth:{token:<access JWT>}`. Server joins `user:<id>`. Events: `notification:new {notification, unreadCount}`. Server disconnects when the token is invalid; the client reconnects after refreshing its token.

## Signed access URLs
`?st=<token>`: HS256 JWT signed with `JWT_ACCESS_SECRET`-derived key, claims `{sub, fid, purpose, aud:'cv-file'}`, 60 s TTL, bound to one file. Download/preview routes accept either Bearer or `st`. Public share links use their own `at` token.

## Frontend conventions
- Axios client at `src/api/client.js` (adds Bearer, refreshes once on `TOKEN_EXPIRED`, error-code contract from the auth docs). One module per resource in `src/api/`.
- Context: `AuthContext`, `ThemeContext`, `ToastContext`, `NotificationContext` (socket).
- Routes: `/login /register /forgot-password /reset-password /verify-email`, `/s/:token` (public share), and under the app shell: `/` dashboard, `/files` & `/files/:folderId`, `/shared`, `/starred`, `/recent`, `/trash`, `/search`, `/activity`, `/notifications`, `/settings`, `/admin/*`.

---
# Implementation notes (deviations from the contract above)
- Uploads: a file over `MAX_UPLOAD_BYTES` rejects the whole request with 413 `FILE_TOO_LARGE`; bad extension, quota and invalid names are per-file results.
- Rename keeps the extension. New versions must keep the extension (422 `EXTENSION_MISMATCH`). Deleting a version is owner-only.
- `GET /folders/:id/download` enforces access then returns 501. `access-url` returns a relative path.
- Trash restore: only the top-level deleted item can be restored; children return 409 `RESTORE_PARENT_FIRST`. If the parent is gone the item is restored to root (auto-renamed on clash).
- Share link tokens are stored raw (so owners can re-copy the URL); password-protected links use a wrong-password 403 `INVALID_LINK_PASSWORD` and `?at=`/`X-Link-Access` unlock tokens.
- Extra endpoints: `GET /public/links/:token/folder`, `/public/links/:token/files/:fileId/{download|preview}`, `GET /admin/shares`, `DELETE /admin/shares/links/:id`, `DELETE /admin/users/:id?purge=true` (409 `USER_HAS_CONTENT` otherwise).
- Admin role keys accept role name or slug (`standard-user`). Peers of equal rank need `admin:manage-admins`. Nobody edits their own roles/status/quota; the last active Super Admin is protected.
- Avatars need the Bearer header, so the SPA fetches them as blobs.
- Storage warning threshold is `QUOTA_WARNING_PERCENT` (default 80).
