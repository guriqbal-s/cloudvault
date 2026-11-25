# CloudVault
A full-stack cloud file storage app in the style of Google Drive or Dropbox. Upload, organise, version,
share and search files from a responsive web app that works on desktop and phone.

- **Files and folders:** upload (drag and drop), preview, download, rename, move, nested folders, every upload versioned
- **Sharing:** share with people (Viewer / Editor, download on/off) or with expiring, password-protected public links
- **Organise:** starred, recent, fast search by name, trash with restore (auto-purged after 30 days)
- **Live updates:** notifications arrive instantly over WebSockets
- **Accounts:** sign up, email verification, password reset, sessions, profile, light/dark theme
- **Admin:** user management, roles and permissions (RBAC), storage quotas, activity log, analytics

**Stack:** React 18 + Vite + Tailwind (frontend) · Node.js + Express + Socket.IO (API) · MySQL + Prisma (database)

---

## Quick start (run it on your computer)

Install **Node.js 20.11 or newer** ([download](https://nodejs.org)) and Docker with Compose for local MySQL.

```bash
# 1. Install frontend and backend dependencies
npm install

# 2. One-time setup: creates .env, the database, the tables and demo data
npm run setup:local

# 3. Start the database, API and web app together
npm run dev:local
```

Open **http://localhost:5173** and sign in:

| Email | Password |
|---|---|
| `alice@cloudvault.dev` | `CloudVault#2026` |

Press **Ctrl+C** to stop the API and web app. Run `docker compose stop mysql` to stop MySQL. The Compose volume retains the local database.

---

## How the pieces connect

```
  Browser ──► http://localhost:5173   Vite dev server (React app)
                   │
                   │  /api/*  and  /socket.io   (proxied, so the browser only sees one address)
                   ▼
              http://localhost:4000   Express API + Socket.IO   (backend/)
                   │
                   │  Prisma, using DATABASE_URL from .env
                   ▼
              localhost:3307          MySQL 8.4 in Docker (persistent volume)
              ─ or ─ AWS RDS          (see "Using AWS RDS" below)

  Uploaded file contents ──► storage/  (on disk, next to the code)
```

- The frontend never talks to the database. It calls the API at `/api/v1/...`.
- In development, Vite forwards `/api` and `/socket.io` to the API on port 4000
  ([frontend/vite.config.js](frontend/vite.config.js)). Keeping everything on one origin is what lets
  the secure sign-in cookie work without extra CORS setup.
- All configuration lives in one file, **`.env`** in the project root. The API, the database scripts
  and the seed script all read it.

---

## Things to try

Each demo account shows a different part of the app. The password for all of them is `CloudVault#2026`.

| Email | Role | What to look at |
|---|---|---|
| `alice@cloudvault.dev` | Standard User | Main demo: nested folders, a PDF with 3 versions, shares, links, trash |
| `bob@cloudvault.dev` | Standard User | 25 MB quota, about 85% used (storage warning) |
| `manager@cloudvault.dev` | Manager | A shared spreadsheet and a team folder |
| `viewer@cloudvault.dev` | Viewer | Read-only role; a folder shared without download |
| `admin@cloudvault.dev` | Admin | Admin panel (cannot manage other admins) |
| `superadmin@cloudvault.dev` | Super Admin | Everything, including the roles matrix |
| `suspended@cloudvault.dev` | Standard User | Suspended: login is refused |
| `pending@cloudvault.dev` | Standard User | Email not verified: login asks for verification |

A good test run:

1. **Alice:** upload a file (drag it onto My Files), preview it, upload a new version, star it, search for it.
2. **Live sharing:** open a private window, sign in as **Bob**, then as Alice share a file with
   `bob@cloudvault.dev`. Bob's bell updates instantly, without a reload.
3. **Trash:** delete a folder, then restore it from Trash.
4. **Admin:** sign in as **superadmin** and open Admin to see users, roles, storage and activity.
5. **Phone layout:** open your browser's dev tools device toolbar (F12, then Ctrl+Shift+M) to see the
   mobile layout with the bottom tab bar.

**Emails** (verification, password reset) are printed in the terminal while `SMTP_HOST` is empty.
Copy the link from the `[api]` output.

---

## Commands

Run these from the project root.

| Command | What it does |
|---|---|
| `npm run setup:local` | One-time local setup (creates `.env`, database, tables, demo data). Safe to re-run: it re-seeds the demo data |
| `npm run dev:local` | Start local MySQL, the API and the web app |
| `npm run dev` | Start API + web app only (use this with AWS RDS, or if the database is already running) |
| `npm run db:local` | Start only local MySQL (keeps running until Ctrl+C) |
| `npm run db:check` | Test the connection in `DATABASE_URL` and explain any problem |
| `npm run db:setup` | Create the database if needed, apply migrations, seed demo data |
| `npm run db:seed` | Reset the demo data (**wipes** all app data first) |
| `npm run db:studio` | Browse the database in Prisma Studio (the database must be running) |
| `npm test` | Backend unit tests (248; no database needed) |
| `npm run build` | Production build of the frontend into `frontend/dist/` |

<details>
<summary>More database commands</summary>

| Command | What it does |
|---|---|
| `npm run db:setup:prod` | Like `db:setup` but seeds only roles and permissions (no demo users) |
| `npm run db:seed:core` | Seed only roles and permissions |
| `npm run db:deploy` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` (`prisma migrate dev`) |
| `npm run db:reset` | Drop everything, re-apply migrations, re-seed |
| `npm run db:generate` | Regenerate the Prisma client (runs automatically after `npm install`) |

`db:setup`, `db:check` and `db:studio` use the database in `DATABASE_URL`.
With local MySQL, start it first (`npm run db:local` in a second terminal) before running
`db:seed`, `db:studio`, `db:deploy` or `db:migrate`.

</details>

---

## Using AWS RDS instead of the local database

For an RDS for MySQL 8.4 instance, fill in the RDS connection URL in the root `.env` and install its CA certificate. See [Connecting to AWS RDS](docs/aws-rds-setup.md) for the connection settings and migration steps.

---

## Configuration

Everything is in `.env` (created by `setup:local` from [.env.example](.env.example), which documents every
setting). The ones you are most likely to change:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | RDS template | MySQL connection URL (local or RDS) |
| `JWT_ACCESS_SECRET` | random (generated) | Signs sign-in tokens. Keep it secret |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | Set `false` to let new sign-ups log in without verifying |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | empty | Fill in to send real emails; empty prints them to the terminal |
| `MAX_UPLOAD_BYTES` | 100 MB | Largest single file |
| `DEFAULT_QUOTA_BYTES` | 5 GB | Storage per new user |
| `ALLOWED_EXTENSIONS` | pdf, docx, png, … | Which file types can be uploaded |
| `STORAGE_ROOT` | `./storage` | Where uploaded file contents are written |

Change a setting, then restart `npm run dev:local`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` warns that install scripts were skipped | Your npm version asks before running package scripts. The needed ones are approved in `package.json` (`allowScripts`); if Prisma still complains, run `npm rebuild` |
| `Port 5173 / 4000 is already in use` | Another copy is still running. Close that terminal, or end the stray `node` process in Task Manager |
| `could not start the local database` | Close other copies of `dev:local`. If it persists, delete the `.local-db` folder (**erases local data**) and run `npm run setup:local` again |
| Sign-in fails with the demo password | Re-run `npm run setup:local` to reset the demo data. In `.env` the password must be quoted: `SEED_DEFAULT_PASSWORD="CloudVault#2026"` (unquoted, `#` starts a comment) |
| `Cannot connect to the database` when using `npm run dev` | `npm run dev` does not start local MySQL. Use `npm run dev:local`, or start `npm run db:local` in another terminal |
| RDS connection problems | `npm run db:check` explains the cause; see the troubleshooting table in [docs/aws-rds-setup.md](docs/aws-rds-setup.md) |
| Want to start from scratch | Stop everything, delete `.local-db/` and `storage/versions/`, run `npm run setup:local` |

---

## Project structure

```
cloudvault/
  backend/            Express API
    src/
      config/         env.js (validated .env), db.js (Prisma), cors, mail
      routes/         URL → controller mapping, all under /api/v1
      controllers/    request/response handling
      services/       business logic (*.logic.js) and wiring (*.service.js)
      middleware/     auth, permissions, validation, rate limiting, uploads, errors
      sockets/        Socket.IO (live notifications)
      jobs/           scheduled jobs (trash purge, link expiry, storage snapshots)
    test/             unit tests (node --test)
  frontend/           React app
    src/
      pages/          one folder per screen (files, shared, admin, settings, …)
      components/     UI kit (ui/), layout, drive browser, modals
      api/            API client (axios) with automatic token refresh
      context/        auth, theme, notifications, toasts
  prisma/
    schema.prisma     database schema
    migrations/       Versioned MySQL migrations
    seed.js           demo data
    scripts/          db-setup.js, db-check.js
  scripts/            setup-local.js (local MySQL bootstrap)
  storage/            uploaded file contents (git-ignored)
  docs/               detailed documentation
  .env.example        every setting, documented
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/aws-rds-setup.md](docs/aws-rds-setup.md) | Connecting to AWS RDS, step by step |
| [docs/architecture.md](docs/architecture.md) | How the system is built and why |
| [docs/database-schema.md](docs/database-schema.md) | Tables, relations and indexes |
| [docs/api-documentation.md](docs/api-documentation.md) | REST endpoints and Socket.IO events |
| [docs/authentication.md](docs/authentication.md) | Sign-in, tokens, sessions, auth error codes |
| [docs/frontend-guide.md](docs/frontend-guide.md) | Frontend structure and conventions |

## Notes for developers

- **API responses** always look like `{ success: true, data, message?, meta? }` or
  `{ success: false, error: { code, message, details? } }`.
- **Two-layer permissions:** an action needs both the role permission (e.g. `file:update`) and access to
  that specific item (owner, direct share, or a share on a parent folder). Items you can't see return 404,
  not 403, so their existence isn't revealed.
- **Testable logic:** `*.logic.js` files receive their dependencies (database, clock, mailer) as arguments
  and are unit-tested without a database; the matching `*.service.js` wires in the real ones.
- **Storage keys are opaque** (`versions/users/<ownerId>/<fileId>/v<n>`); the database never stores
  absolute paths, so file storage can move to S3 later behind the same `StorageProvider` interface.
- **Quota** counts every version of every file you own, including items in the trash until they are purged.
- **Names are unique per folder, case-insensitively**, among items that aren't in the trash.
- **Changing the schema:** edit `prisma/schema.prisma`, run `npm run db:migrate` with the database
  running (Prisma asks for a migration name), and commit the new folder in `prisma/migrations/`.
