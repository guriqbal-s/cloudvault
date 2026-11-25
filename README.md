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

Install **Node.js 22 or newer** ([download](https://nodejs.org)) and Docker with Compose for local MySQL.

```bash
# 1. Install frontend and backend dependencies
npm install

# 2. One-time setup: creates .env, the database, the tables, roles and permissions
npm run setup:local

# 3. Create the Super Admin and Admin accounts (see "Creating the admin accounts" below)

# 4. Start the database, API and web app together
npm run dev:local
```

Open **http://localhost:5173** and sign in with one of the admin accounts, or click **Sign up** to create
a regular account.

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

## Creating the admin accounts

The database starts with no user accounts. `npm run db:setup` (and `setup:local`) creates only the
tables, the five roles and their permissions. Create the two admin accounts with SQL:

| Role | Default email in the script | Can do |
|---|---|---|
| Super Admin | `superadmin@cloudvault.dev` | Everything, including the roles and permissions matrix |
| Admin | `admin@cloudvault.dev` | Admin panel: users, quotas, storage, activity (cannot manage other admins) |

1. Make a bcrypt hash for each password (10+ characters, at least one letter and one number):

   ```bash
   npm run hash-password -- "YourSuperAdminPassword#1"
   npm run hash-password -- "YourAdminPassword#1"
   ```

2. Open [database/create-admins.sql](database/create-admins.sql), paste the two hashes into
   `@superadmin_hash` and `@admin_hash`, and change the emails and names if you want.

3. Run the file against the database with MySQL Workbench, DBeaver or the mysql CLI:

   ```bash
   # Local Docker MySQL
   docker compose exec -T mysql mysql -uroot -pcloudvault-local-root < database/create-admins.sql

   # AWS RDS
   mysql -h database-1.cryam8ioiwyg.eu-north-1.rds.amazonaws.com -P 3306 -u YOUR_DB_USER -p \
         --ssl-ca=prisma/rds-ca.pem cloudvault < database/create-admins.sql
   ```

   The last query lists both accounts as `ACTIVE`, each with its role. The accounts are already
   email-verified, so they can sign in right away.

You can re-run the script safely. It never creates a duplicate account or changes an existing
password. [database/login.sql](database/login.sql) has SQL to create more users, reset a password,
suspend someone or change a role. Admins can also do all of this from the **Admin** page.

New accounts created on the **Sign up** page get the Standard User role.

**Emails** (verification, password reset) are printed in the terminal while `SMTP_HOST` is empty.
Copy the link from the `[api]` output.

---

## Commands

Run these from the project root.

| Command | What it does |
|---|---|
| `npm run setup:local` | One-time local setup (creates `.env`, database, tables, roles and permissions). Safe to re-run: it never deletes data |
| `npm run dev:local` | Start local MySQL, the API and the web app |
| `npm run docker:up` | Build and start the containers over plain HTTP on port 8080 (try the containers locally) |
| `npm run docker:down` | Stop the containers |
| `npm run prod:up` | Production: build, migrate and start with HTTPS on `DOMAIN` ([docs/deployment.md](docs/deployment.md)) |
| `npm run prod:logs` / `prod:down` | Follow the production logs / stop production |
| `npm run dev` | Start API + web app only (use this with AWS RDS, or if the database is already running) |
| `npm run db:local` | Start only local MySQL (keeps running until Ctrl+C) |
| `npm run db:check` | Test the connection in `DATABASE_URL` and explain any problem |
| `npm run db:setup` | Create the database if needed, apply migrations, seed roles and permissions |
| `npm run db:seed` | Create or update the roles and permissions (no users, never deletes data) |
| `npm run hash-password -- "pw"` | Print a bcrypt hash for `database/create-admins.sql` or `database/login.sql` |
| `npm run db:studio` | Browse the database in Prisma Studio (the database must be running) |
| `npm test` | Backend unit tests (264; no database, Cloudinary or Redis needed) |
| `npm run build` | Production build of the frontend into `frontend/dist/` |

<details>
<summary>More database commands</summary>

| Command | What it does |
|---|---|
| `npm run db:deploy` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` (`prisma migrate dev`) |
| `npm run db:reset` | Drop everything, re-apply migrations, re-seed roles and permissions (create the admin accounts again afterwards) |
| `npm run db:generate` | Regenerate the Prisma client (runs automatically after `npm install`) |

`db:setup`, `db:check` and `db:studio` use the database in `DATABASE_URL`.
With local MySQL, start it first (`npm run db:local` in a second terminal) before running
`db:seed`, `db:studio`, `db:deploy` or `db:migrate`.

</details>

---

## Using AWS RDS, Cloudinary and Docker locally

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
npm run db:setup          # applies migrations + seeds roles and permissions
# now create the admin accounts (see "Creating the admin accounts" above)
npm run docker:up         # builds and starts the api and web containers
```

Open **http://localhost:8080** (`WEB_PORT` in `.env`). `npm run docker:logs` follows the logs and
`npm run docker:down` stops the containers. Without Docker, `npm run dev` runs the same setup
on http://localhost:5173.

- **Docker:** [Dockerfile](Dockerfile) builds three images. `migrate` applies migrations and seeds roles and
  permissions, `api` runs the API, and `web` is nginx serving the React build and proxying `/api` and `/socket.io` to the API
  ([docker/nginx.conf](docker/nginx.conf)). `.env` is passed in at runtime and never copied into an image.
  The local `mysql` service only starts with `npm run dev:local` / `db:local`.
- **Cloudinary:** files are stored as private raw assets under `CLOUDINARY_FOLDER` (default `cloudvault/`).
  The API checks access and then streams the bytes, so Cloudinary URLs never reach the browser.
  The Free plan limits raw files to **10 MB**; set `MAX_UPLOAD_BYTES=10485760` on that plan.
- **RDS security group:** must allow inbound TCP 3306 from the machine running the API.

See [Connecting to AWS RDS](docs/aws-rds-setup.md) for details and troubleshooting.

---

## Deploying to production

Production runs on any Linux server with Docker: **Caddy** (automatic HTTPS) → **nginx** (React
app, security headers, load balancing) → **API replicas** → **AWS RDS + Cloudinary + Redis**.
The full step-by-step guide is in **[docs/deployment.md](docs/deployment.md)**. In short:

```bash
cp .env.example .env      # fill in DOMAIN, ACME_EMAIL, DATABASE_URL, JWT_ACCESS_SECRET,
                          # CLOUDINARY_*, SMTP_*, MAIL_FROM  (and put prisma/rds-ca.pem in place)
npm run prod:config       # validate the compose configuration
npm run prod:up           # build, migrate, start: https://<DOMAIN>
# then create the admin accounts (see "Creating the admin accounts" above)
```

**What makes it production-ready**

| Concern | How it's handled |
|---|---|
| Safe configuration | With `NODE_ENV=production` the API refuses to start on a weak `JWT_ACCESS_SECRET`, insecure cookies, a non-HTTPS `CLIENT_URL`, missing SMTP or an unverified sender address, and names each problem |
| HTTPS | Caddy gets and renews a Let's Encrypt certificate, redirects HTTP and sends HSTS |
| Browser security | Strict Content-Security-Policy (no inline scripts), nosniff, Referrer-Policy and Permissions-Policy on the app; helmet on the API; refresh cookie is `httpOnly`, `Secure`, `SameSite=Strict` |
| Containers | The API image holds production dependencies only, runs as a non-root user on Node 22 LTS, with tini as PID 1 for clean shutdown |
| Migrations | A one-shot `migrate` container applies migrations and the roles/permissions seed before any API replica starts |
| Rate limits | Counters live in Redis, so limits hold across all instances |
| Live notifications | Socket.IO Redis adapter: an event raised on any instance reaches users on every instance |
| Background jobs | Every instance schedules them, but a per-tick Redis claim lets only one instance run each tick |
| Health checks | `/api/v1/health/live` (process up, used by Docker) and `/api/v1/health/ready` (database and storage reachable, for load balancers and uptime monitors) |
| Logs | One JSON object per line with a `requestId`. Every response carries `X-Request-Id`, and 500 error bodies include it. Query strings are never logged. Docker rotates the log files |
| Scaling | `API_REPLICAS=4 npm run prod:up`. The API is stateless; nginx picks up new replicas via Docker DNS |
| CI | [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the tests, builds the frontend and all three images, and validates the production compose files on every push |

**Before going live**, work through the security checklist in [docs/deployment.md](docs/deployment.md#6-operations):
put the server in the same region as RDS (eu-north-1), set RDS **Public access** to **No**, turn on
RDS automated backups, and keep `API_REPLICAS × connection_limit` below RDS `max_connections`.

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
| Admin sign-in fails | Check the account exists with the last query in `database/create-admins.sql`. The pasted value must be the hash from `npm run hash-password` (it starts with `$2b$`), not the plain password. Reset it with section D of `database/login.sql` |
| `Server is not initialised (roles are missing)` | Run `npm run db:seed`, then run `database/create-admins.sql` again |
| `Cannot connect to the database` when using `npm run dev` | `npm run dev` does not start local MySQL. Use `npm run dev:local`, or start `npm run db:local` in another terminal |
| RDS connection problems | `npm run db:check` explains the cause; see the troubleshooting table in [docs/aws-rds-setup.md](docs/aws-rds-setup.md) |
| Want to start from scratch | Stop everything, delete `.local-db/` and `storage/versions/`, run `npm run setup:local`, then create the admin accounts again |

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
    seed.js           roles and permissions
    scripts/          db-setup.js, db-check.js
  database/           create-admins.sql (first admin accounts), login.sql (account management SQL)
  scripts/            setup-local.js (local MySQL bootstrap), hash-password.js
  docker/             nginx.conf + security headers (web container), Caddyfile (HTTPS edge)
  Dockerfile          api, migrate and web images
  compose.yaml        containers; compose.prod.yaml adds HTTPS and production mode
  .github/workflows/  CI: tests, frontend build, image builds
  storage/            uploaded file contents (git-ignored)
  docs/               detailed documentation
  .env.example        every setting, documented
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/deployment.md](docs/deployment.md) | Deploying to production: HTTPS, configuration, updates, backups, monitoring |
| [docs/aws-rds-setup.md](docs/aws-rds-setup.md) | Connecting to AWS RDS, step by step |
| [docs/architecture.md](docs/architecture.md) | How the system is built and why |
| [docs/database-schema.md](docs/database-schema.md) | Tables, relations and indexes |
| [docs/api-documentation.md](docs/api-documentation.md) | REST endpoints and Socket.IO events |
| [docs/authentication.md](docs/authentication.md) | Sign-in, tokens, sessions, auth error codes |
| [database/create-admins.sql](database/create-admins.sql) | SQL that creates the Super Admin and Admin accounts |
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
