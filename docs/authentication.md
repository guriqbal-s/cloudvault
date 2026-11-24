# Authentication

How sign-in, tokens and sessions work, plus the auth endpoints and the error codes the frontend handles.

All routes are under `/api/v1`. Success: `{ success: true, data, message? }`. Failure:
`{ success: false, error: { code, message, details? } }`.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /auth/register` | public | Create an account (`name`, `email`, `password`). Sends a verification email |
| `POST /auth/verify-email` | public | `{ token }`. Activates the account. A repeat click returns `alreadyVerified: true` |
| `POST /auth/resend-verification` | public | `{ email }`. Always 200, throttled to one email per minute |
| `POST /auth/login` | public | `{ email, password }`. Returns `{ user, accessToken }` and sets the refresh cookie |
| `POST /auth/refresh` | cookie | Rotates the refresh cookie, returns a new `{ user, accessToken }` |
| `POST /auth/logout` | cookie | Revokes the session and clears the cookie (idempotent) |
| `POST /auth/forgot-password` | public | `{ email }`. Always 200, throttled |
| `POST /auth/reset-password` | public | `{ token, password }`. Signs the account out everywhere |
| `GET /auth/me` | Bearer | Current user with `roles` and `permissions` |
| `PATCH /users/me/password` | Bearer | `{ currentPassword, newPassword }`. Keeps this device, signs out the rest |
| `GET /users/me/sessions` | Bearer | Active sessions (`device`, `ip`, `lastActiveAt`, `current`) |
| `DELETE /users/me/sessions/:id` | Bearer | Sign out one of your own sessions |
| `DELETE /users/me/sessions` | Bearer | Sign out every other session |

**Tokens.** The access token (JWT, 15 minutes) is held in memory by the SPA and sent as
`Authorization: Bearer ...`. The refresh token is a random 64-byte value in an `httpOnly`,
`SameSite=Strict` cookie (`cv_rt`) scoped to `/api/v1/auth`; only its SHA-256 hash is stored.
It rotates on every use. Presenting an already-rotated token after a 10 second grace window is
treated as theft: the whole token family and its session are revoked.

**Error codes the frontend should handle**

| Code (HTTP) | Meaning and what the SPA should do |
|---|---|
| `TOKEN_EXPIRED` (401) | Access token expired: call `/auth/refresh` once, then retry the request |
| `REFRESH_RACE` (401) | Another tab just rotated the cookie: retry `/auth/refresh` once |
| `INVALID_TOKEN`, `SESSION_REVOKED`, `NO_REFRESH_TOKEN`, `INVALID_REFRESH_TOKEN`, `REFRESH_EXPIRED`, `REFRESH_REUSE_DETECTED` (401) | Session is over: clear state and go to the login page |
| `INVALID_CREDENTIALS` (401) | Wrong email or password (one message for both) |
| `EMAIL_NOT_VERIFIED` (403) | Offer "resend verification email" |
| `ACCOUNT_SUSPENDED` (403) | Show the suspension message |
| `EMAIL_TAKEN` (409) | Registration: email already used |
| `INVALID_TOKEN`, `TOKEN_EXPIRED` (400) | A verification or reset link is invalid, used, or expired |
| `INVALID_CURRENT_PASSWORD` (400) | Password change: current password is wrong (deliberately not 401) |
| `VALIDATION_ERROR` (422) | `error.details` lists `{ in, path, message }` per field |
| `RATE_LIMITED` (429) | Too many requests |

**Password policy:** 10 to 128 characters with at least one letter and one number, and at most
72 bytes (bcrypt silently ignores anything longer, so longer input is rejected rather than truncated).

**In development, emails are printed to the API console** when `SMTP_HOST` is empty. Copy the
verification or reset link from there. Demo accounts are already verified.

Try it (replace the token and cookie jar as needed):

```bash
curl -i -c jar.txt -H 'Content-Type: application/json' \
  -d '{"email":"alice@cloudvault.dev","password":"CloudVault#2026"}' \
  http://localhost:4000/api/v1/auth/login

curl -H "Authorization: Bearer <accessToken>" http://localhost:4000/api/v1/auth/me
curl -b jar.txt -c jar.txt -X POST http://localhost:4000/api/v1/auth/refresh
```

## Authorisation model

Authorisation has two layers and both must allow an action: the role's permission key
(for example `file:update`) and the resource ACL (owner, direct share, share inherited from an
ancestor folder). A global Viewer cannot edit even if given Editor on a share. Resources the
caller cannot see return 404 (not 403) so existence is not leaked.

API envelope: `{ success: true, data, message?, meta? }` on success and
`{ success: false, error: { code, message, details? } }` on failure.
