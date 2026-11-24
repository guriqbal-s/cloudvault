# Frontend guide (for page authors)

Stack: React 18, Vite, Tailwind 3 (CSS-variable tokens), react-router-dom 6, axios, lucide-react, recharts, socket.io-client. JS only.
Everything below already exists in `frontend/src`. **Import it, do not re-implement it.** Page files you own live in `src/pages/<area>/`; the stubs there are placeholders to overwrite (routes and lazy imports are already wired in `src/routes/AppRoutes.jsx`, do not edit it unless you add a route).

## Design tokens and Tailwind classes
Colours come from CSS variables (light and dark), so **never use raw palette colours** (`bg-white`, `text-gray-500`, `bg-slate-*`); use tokens and dark mode is automatic.

| Purpose | Classes |
|---|---|
| Surfaces | `bg-surface` (cards, panels), `bg-surface-muted` (page), `bg-surface-sunken` (inputs, wells, hover) |
| Text | `text-content`, `text-content-muted`, `text-content-faint` |
| Borders | `border-border`, `border-border-strong` |
| Brand | `bg-brand text-brand-contrast`, `bg-brand-strong`, `bg-brand-soft text-brand` |
| Status | `text-danger bg-danger-soft`, same for `success`, `warning`, `info`, `accent` |
| Shadows | `shadow-card`, `shadow-pop`, `shadow-ring` (focus) |
| Fonts | `font-display` (headings, h1-h3 default), `font-sans` (body), `font-mono` |
| Misc | `.tabular` (tabular numbers), `animate-pop-in`, `animate-fade-in` |

Card pattern: `rounded-2xl border border-border bg-surface shadow-card` (or `<Card>`). Opacity works: `bg-brand/10`. For Recharts pass colours as `rgb(var(--color-brand))` strings so charts follow the theme; useful vars: `--color-brand`, `--color-accent`, `--color-info`, `--color-success`, `--color-warning`, `--color-danger`, `--color-border`, `--color-content-muted`.

## API layer (`src/api/*`)
All functions return a Promise of the envelope's `data` (already unwrapped). Functions marked **paged** return `{ data, meta }`. Every GET accepts a trailing `opts` axios config (pass `{ signal }` from `useQuery`). Errors are axios errors: use `getErrorMessage(err)`, `getErrorCode(err)`, `getFieldErrors(err)` from `utils/errors.js`.
Import style: `import * as filesApi from '../../api/files.js'` (or the barrel `import { filesApi } from '../../api'`).
Token refresh, retry and sign-out are automatic (see `api/client.js`). **Never** put tokens in localStorage.

| Module | Functions |
|---|---|
| `folders.js` | `open(id='root', params)` **paged** -> `{data:{folder,breadcrumbs,folders,files}, meta}` (params: q, sort, order, type, page, limit) · `create({name,parentId})` · `update(id,{name?,parentId?})` · `remove(id)` |
| `files.js` | `upload(files[], {folderId, onProgress(0..1), signal})` -> `{results:[{name,ok,file?,error?}]}` · `get(id)` · `update(id,{name?,folderId?})` · `remove(id)` · `accessUrl(id,'preview'\|'download')` -> `{url,expiresAt}` (use as `<img src>`, `<iframe src>`, `<video src>`) · `download(id)` (starts a browser download) · `fetchText(id)` (txt/csv preview) · `listVersions(id)` · `uploadVersion(id,file,{comment,onProgress})` · `restoreVersion(id,n)` · `deleteVersion(id,n)` · `downloadVersion(id,n,filename)` |
| `trash.js` | `list()` -> `{folders,files}` · `restore(type,id)` · `purge(type,id)` · `empty()` (`type` = `'files'`/`'folders'`) |
| `starred.js` | `list()` · `star(type,id)` · `unstar(type,id)` · `toggle(type,id,currentlyStarred)` |
| `recent.js` | `list({limit})` -> files |
| `search.js` | `search({q,type,ownerId,from,to,minSize,maxSize,page,limit})` **paged** -> `{data:{folders,files}, meta}` |
| `storage.js` | `get()` -> `{used,quota,percent,breakdown:[{category,label,bytes,count}],trashBytes}` |
| `shares.js` | `withMe()` · `byMe()` -> `{folders,files}` · `details(type,id)` -> `{people,links}` · `add(type,id,{email,level,canDownload})` · `update(type,id,userId,{level?,canDownload?})` · `revoke(type,id,userId)` · `createLink(type,id,{expiresAt,password,canDownload})` · `updateLink(linkId,body)` · `revokeLink(linkId)` |
| `users.js` | `lookup(q)` (share autocomplete) · `updateProfile({name})` · `updatePreferences({theme?,notificationPrefs?})` · `changePassword({currentPassword,newPassword})` · `listSessions()` · `revokeSession(id)` · `revokeOtherSessions()` · `uploadAvatar(file)` · `deleteAvatar()` |
| `publicLinks.js` | `metadata(token)` · `unlock(token,password)` -> `{accessToken}` · `url(token,'download'\|'preview', unlockToken)` (no login needed) |
| `notifications.js` | `list({unread,page,limit})` **paged** (`meta.unreadCount`) · `markRead(id)` · `markAllRead()` · `remove(id)` (prefer `useNotifications()` for state) |
| `activity.js` | `list({action,from,to,page,limit})` **paged** |
| `dashboard.js` | `get()` -> `{storage,counts,byCategory,uploadsOverTime,recentFiles,recentActivity}` |
| `admin.js` | `stats()` · `listUsers(params)` **paged** · `createUser` · `getUser(id)` · `updateUser(id,body)` · `setUserRoles(id,roleKeys)` · `deleteUser(id)` · `revokeUserSessions(id)` · `listRoles()` · `listActivity(params)` **paged** · `storageOverview()` |

After anything that changes storage use (upload, delete, purge, restore, new version) call `notifyStorageChanged()` from `utils/events.js`; the sidebar meter refreshes itself.

## Hooks (`src/hooks`)
- `useQuery(loader, deps, { enabled, initialData, keepPrevious })` -> `{ data, loading, error, refetch({silent}), setData }`. `loader` receives `{ signal }`: `useQuery(({signal}) => foldersApi.open(id, params, { signal }), [id, params.page])`. Stale responses are ignored; changing deps aborts the previous request. Use `refetch({ silent: true })` after mutations to avoid a skeleton flash; `setData(fn)` for optimistic updates.
- `useAsync(fn)` -> `[run, { pending, error, reset }]` for mutations. `run` rethrows, so `try { await run(x) } catch (e) { toast.error(getErrorMessage(e)) }`.
- `useDebounce(value, ms=300)`.
- `usePermissions()` -> `{ has(key), hasAny(...keys), hasAll(...keys), isAdmin, roles, permissions }`. UI gating only.
- `usePageTitle(title)` (PageHeader already calls it), `useOverlay`, `useClickOutside` (internals, usable).
- Contexts: `useAuth()` -> `{ user, status, isAuthenticated, login, logout, reloadUser, updateUser(patch) }` (call `updateUser({name})` after saving a profile) · `useToast()` -> `toast.success|error|warning|info(message, {title, action:{label,onClick}, duration})` · `useTheme()` -> `{ preference, resolved, setPreference }` · `useNotifications()` -> `{ items, unreadCount, loading, connected, reload, markRead, markAllRead, remove }` (live via Socket.IO; only available inside the app shell).

## UI kit (`src/components/ui`, barrel `components/ui/index.js`)
| Component | Props / notes |
|---|---|
| `Button` | `variant` primary\|secondary\|ghost\|danger\|danger-ghost\|soft · `size` sm\|md\|lg · `loading` · `leftIcon`/`rightIcon` · `icon` (square icon-only; **always pass `aria-label`**) · `as={Link} to=` |
| `Input` | `label hint error leftIcon rightSlot revealable(password) required` + native props. `error` is a message string. `Textarea` (same props), `Field` (wrapper for custom controls) |
| `Select` | `label error placeholder options=[{value,label}]` or `<option>` children; native `<select>` |
| `Switch` / `Checkbox` | `checked onChange(bool) label description disabled` |
| `Modal` | `open onClose title description size(sm..full) footer closeOnBackdrop`. Add `data-autofocus` to the element to focus first |
| `Drawer` | `open onClose title side(right\|left) width(sm..xl) footer bare` |
| `Menu`, `MenuItem`, `MenuSeparator`, `MenuLabel` | `<Menu trigger={<Button icon aria-label="More"/>} align="end">` items close the menu on click. Context menus: `<FloatingMenu open point={{x,y}} onClose>` with `<MenuContext.Provider value={onClose}>` around items |
| `Tabs` | `items=[{id,label,icon,count}] value onChange variant(underline\|pill)`; route tabs: items with `to` |
| `Badge` | `tone` neutral\|brand\|success\|warning\|danger\|info\|accent, `dot`, `icon` |
| `Avatar` | `user={{id,name,hasAvatar}} size(xs..xl) version` (loads the image with auth; bump `version` after upload, `invalidateAvatar(id)`) |
| `Card`, `CardHeader` | `padding` none\|sm\|md\|lg; `CardHeader title description action` |
| `Skeleton`, `SkeletonRows` | loading placeholders (`className="h-4 w-40"`) |
| `EmptyState` | `icon title description action compact` |
| `Spinner`, `ProgressBar` | `ProgressBar value max tone(auto\|brand\|success\|danger) size label` |
| `Pagination` | `meta` (straight from the API) `onPageChange(page)` |
| `ConfirmDialog` | `open title description confirmLabel tone(danger) onConfirm(async) onClose`; shows errors thrown by `onConfirm` |
| `Tooltip` | `content side` (wraps one child) |

Common (`components/common`): `PageHeader {title, description, breadcrumbs, actions, icon}` (use at the top of every page), `Breadcrumbs {items:[{label,to,onClick}]}`, `ErrorState {error,onRetry}`, `Logo`, `ErrorBoundary`.

## Utilities (`src/utils`)
`cn(...classes)` · `formatBytes`, `formatNumber`, `formatPercent`, `formatDate`, `formatDateTime`, `formatRelative`, `initials`, `pluralize` (format.js) · `FileIcon {item, size}` and `getFileVisual(item)` (fileIcons.jsx; `item` is a file/folder DTO or a category name) · `getNotificationMeta(type)`, `notificationLink(n)` (notifications.jsx) · `getErrorMessage/Code/FieldErrors`, `isCanceled` (errors.js) · `on/emit`, `notifyStorageChanged` (events.js).

## DTO shapes
See `docs/api-contract.md`. Every file/folder has `kind` ('file'|'folder'), `access.capabilities` (`read, download, update, version, createChild, delete, share`: **gate buttons on these**, not on roles), `starred`, `shared`, `owner{id,name}`. Folder listing responses put folders and files in separate arrays.

## Conventions
- Page = `<PageHeader …/>` + content. Handle the four states: loading (Skeleton), error (`ErrorState` with retry), empty (`EmptyState`), data.
- Every destructive action goes through `ConfirmDialog`; every mutation reports with a toast; failures use `getErrorMessage`.
- Icon-only buttons need `aria-label`; forms use `Input`/`Select` so errors are announced.
- Mobile first: lists must work at 360px (stack columns, hide secondary columns with `hidden sm:table-cell`).
- Route params: `/files/:folderId` -> `useParams().folderId` (undefined = root). Search page reads `?q=` with `useSearchParams`.
- Public share page (`/s/:token`) is rendered outside the app shell and without a session: use only `publicLinks.js`.

## Verifying without installing packages
`node` script idea used in this repo: bundle `src/main.jsx` with esbuild, marking npm packages `external`. It fails on missing local files and missing named exports.
