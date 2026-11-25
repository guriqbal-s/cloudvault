# CloudVault
A full-stack cloud file storage app in the style of Google Drive or Dropbox. Upload, organise, version,
share and search files from a responsive web app that works on desktop and phone.

- **Files and folders:** upload (drag and drop), preview, download, rename, move, nested folders, every upload versioned
- **Sharing:** share with people (Viewer / Editor, download on/off) or with expiring, password-protected public links
- **Organise:** starred, recent, fast search by name, trash with restore (auto-purged after 30 days)
- **Live updates:** notifications arrive instantly over WebSockets
- **Accounts:** sign up, email verification, password reset, sessions, profile, light/dark theme
- **Admin:** user management, roles and permissions (RBAC), storage quotas, activity log, analytics

**Stack:** React 18 + Vite + Tailwind (frontend) · Node.js + Express + Socket.IO (API) · MySQL on AWS RDS + Prisma (database) · Cloudinary (file storage) · Docker

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

  Uploaded file contents ──► Cloudinary (STORAGE_DRIVER=cloudinary, private "authenticated" raw assets)
                         ─ or ─ storage/ on disk (STORAGE_DRIVER=local)
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
| `npm run docker:up` | Build and start the api + web containers (RDS + Cloudinary from `.env`) |
| `npm run docker:down` | Stop the containers |
| `npm run dev` | Start API + web app only (use this with AWS RDS, or if the database is already running) |
| `npm run db:local` | Start only local MySQL (keeps running until Ctrl+C) |
| `npm run db:check` | Test the connection in `DATABASE_URL` and explain any problem |
| `npm run db:setup` | Create the database if needed, apply migrations, seed demo data |
| `npm run db:seed` | Reset the demo data (**wipes** all app data first) |
| `npm run db:studio` | Browse the database in Prisma Studio (the database must be running) |
| `npm test` | Backend unit tests (261; no database, Cloudinary or Redis needed) |
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

## Using AWS RDS, Cloudinary and Docker

`.env` is already set up for the CloudVault RDS instance
(`database-1.cryam8ioiwyg.eu-north-1.rds.amazonaws.com`, port `3306`) and for Cloudinary storage.
The RDS CA bundle for eu-north-1 is in `prisma/rds-ca.pem` (git-ignored). Fill in the remaining
placeholders in `.env`:

| Placeholder | Where to find it |
|---|---|
| `YOUR_DB_USER`, `YOUR_DB_PASSWORD` (in `DATABASE_URL`) | RDS console > your instance > Configuration > Master username, and its password. Percent-encode special characters |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary console > Settings > API Keys (or set `CLOUDINARY_URL` instead) |

Then create the tables and start the app:

```bash
npm run db:check          # confirms the RDS connection and TLS
npm run db:setup          # applies migrations + seeds demo data (uploads demo files to Cloudinary)
npm run docker:up         # builds and starts the api and web containers
```

Open **http://localhost:8080** (`WEB_PORT` in `.env`). `npm run docker:logs` follows the logs and
`npm run docker:down` stops the containers. Without Docker, `npm run dev` runs the same setup
on http://localhost:5173.

- **Docker:** [Dockerfile](Dockerfile) builds two images. `api` runs `prisma migrate deploy` and then the
  API; `web` is nginx serving the React build and proxying `/api` and `/socket.io` to the API
  ([docker/nginx.conf](docker/nginx.conf)). `.env` is passed in at runtime and never copied into an image.
  The local `mysql` service only starts with `npm run dev:local` / `db:local`.
- **Cloudinary:** files are stored as private raw assets under `CLOUDINARY_FOLDER` (default `cloudvault/`).
  The API checks access and then streams the bytes, so Cloudinary URLs never reach the browser.
  The Free plan limits raw files to **10 MB**; set `MAX_UPLOAD_BYTES=10485760` on that plan.
- **RDS security group:** must allow inbound TCP 3306 from the machine running the API.

See [Connecting to AWS RDS](docs/aws-rds-setup.md) for details and troubleshooting.

---

## Running in production and scaling

The API is **stateless**: data lives in RDS, files in Cloudinary, and shared runtime state in Redis.
To handle more traffic, run more API instances behind a load balancer.

```bash
npm run docker:up                    # migrate once, then redis + 2 api replicas + nginx
API_REPLICAS=4 npm run docker:up     # scale out
```

| Concern | How it's handled |
|---|---|
| Rate limits | Counters live in Redis, so limits hold across all instances (`REDIS_URL`) |
| Live notifications | Socket.IO Redis adapter: an event raised on any instance reaches users on every instance. Clients use WebSocket first, so no sticky sessions are needed |
| Background jobs | Every instance schedules them, but a per-tick Redis claim lets only one instance run each tick |
| Migrations | A one-shot `migrate` container applies them before any API replica starts |
| Load balancing | nginx spreads `/api` and `/socket.io` across replicas and picks up scaled replicas via Docker DNS |
| Health checks | `GET /api/v1/health` checks the database and storage; the storage result is cached and refreshed in the background so probes stay fast |
| Without Redis | `REDIS_URL` empty = single-instance mode (in-memory), e.g. `npm run dev` |

**Go-live checklist**

1. **Same region:** run the API in **eu-north-1** (same as RDS). Across regions every query pays
   about 150 ms of round trip, which makes sign-in take seconds.
2. **HTTPS + domain:** put the web container behind TLS (AWS ALB, Cloudflare, or Caddy), then set
   `PUBLIC_URL=https://your-domain`, `DOCKER_NODE_ENV=production` and `COOKIE_SECURE=true` in `.env`.
   Production mode refuses to start without a secure cookie and a random `JWT_ACCESS_SECRET` of 32+ characters.
3. **Lock down RDS:** after moving the API into AWS, set RDS **Public access** back to **No** and allow
   port 3306 only from the API's security group, not from your home IP.
4. **Connection budget:** each API instance opens up to `connection_limit` (10) MySQL connections.
   Keep `replicas × connection_limit` under the instance's `max_connections` (small RDS classes allow roughly 60 to 150).
5. **Managed Redis:** for more than one host, point `REDIS_URL` (or `DOCKER_REDIS_URL` for compose) at ElastiCache
   instead of the bundled container.
6. **Email:** fill in `SMTP_*` (e.g. Amazon SES) so verification and reset emails are actually sent.
7. **Cloudinary plan:** downloads stream through the API, so Cloudinary bandwidth and API instance
   bandwidth both grow with traffic. On the Free plan keep `MAX_UPLOAD_BYTES` at 10 MB.
8. **Local storage does not scale:** `STORAGE_DRIVER=local` keeps files inside one container; use Cloudinary
   with more than one replica.

---

## Configuration

Everything is in `.env` (created by `setup:local` from [.env.example](.env.example), which documents every
setting). The ones you are most likely to change:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | CloudVault RDS endpoint | MySQL connection URL (local or RDS) |
| `JWT_ACCESS_SECRET` | random (generated) | Signs sign-in tokens. Keep it secret |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | Set `false` to let new sign-ups log in without verifying |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | empty | Fill in to send real emails; empty prints them to the terminal |
| `MAX_UPLOAD_BYTES` | 100 MB | Largest single file |
| `DEFAULT_QUOTA_BYTES` | 5 GB | Storage per new user |
| `ALLOWED_EXTENSIONS` | pdf, docx, png, … | Which file types can be uploaded |
| `STORAGE_DRIVER` | `cloudinary` | `cloudinary` or `local` (disk) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | placeholders | Cloudinary account credentials (or one `CLOUDINARY_URL`) |
| `CLOUDINARY_FOLDER` | `cloudvault` | Folder for all objects in the Media Library |
| `STORAGE_ROOT` | `./storage` | Upload staging area; also file contents with `STORAGE_DRIVER=local` |
| `WEB_PORT` | `8080` | Port for the Docker web container |

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
  docker/             nginx.conf for the web container
  Dockerfile          api and web images (used by compose.yaml)
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
| [database/login.sql](database/login.sql) | SQL for login accounts: create users, verify, reset passwords, suspend, roles, sign-in reports (`npm run hash-password -- "pw"` makes the password hash) |
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
  absolute paths. `LocalStorageProvider` and `CloudinaryStorageProvider` implement the same
  `StorageProvider` interface in `backend/src/services/storage/`.
- **Quota** counts every version of every file you own, including items in the trash until they are purged.
- **Names are unique per folder, case-insensitively**, among items that aren't in the trash.
- **Changing the schema:** edit `prisma/schema.prisma`, run `npm run db:migrate` with the database
  running (Prisma asks for a migration name), and commit the new folder in `prisma/migrations/`.
