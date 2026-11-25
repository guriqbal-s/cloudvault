# Deploying CloudVault to production

This guide deploys CloudVault on a single Linux server (for example an AWS EC2 instance) with
Docker Compose. Caddy terminates HTTPS with an automatic Let's Encrypt certificate. The database
is AWS RDS for MySQL and file contents live in Cloudinary, so the server itself holds no data.

```
Internet ──► caddy :80/:443      TLS certificate, HTTP→HTTPS redirect, HSTS
               │
               ▼
             web (nginx)          React app + security headers, load-balances /api and /socket.io
               │
               ▼
             api × N              Node.js API (NODE_ENV=production), stateless
               │        ╲
               ▼         ▼
             AWS RDS    redis      shared rate limits, live notifications, job locks
             Cloudinary
```

`migrate` runs once on every deploy, before any API container starts. It applies the
database migrations and creates or updates the roles and permissions.

---

## 1. Prepare

| You need | Notes |
|---|---|
| A Linux server with Docker Engine and Compose **v2.24+** | 2 vCPU / 2 GB RAM runs 2 API replicas comfortably. Put it in the **same AWS region as RDS** (eu-north-1): cross-region queries add about 150 ms each |
| A domain name | Create an A (and AAAA, if you use IPv6) record pointing at the server, e.g. `files.example.com` |
| Open ports 80 and 443 | Security group / firewall. Port 80 is needed for the certificate challenge and the HTTPS redirect |
| AWS RDS for MySQL 8.x | See [aws-rds-setup.md](aws-rds-setup.md). Allow inbound 3306 **only from the server's security group** |
| Cloudinary account | Settings > API Keys |
| SMTP provider | Amazon SES, Postmark, SendGrid, etc., with a verified sender domain |

## 2. Configure

On the server:

```bash
git clone https://github.com/<you>/cloudvault.git
cd cloudvault
cp .env.example .env
chmod 600 .env
```

Edit `.env`. The API **refuses to start in production** if any of these are missing or unsafe,
and the error message names the setting.

| Setting | Value |
|---|---|
| `DOMAIN` | `files.example.com` (no `https://`) |
| `ACME_EMAIL` | Your email, for certificate expiry notices |
| `DATABASE_URL` | RDS URL with `sslcert=rds-ca.pem&sslaccept=strict`. Use a dedicated MySQL user, not the master user, once the schema exists |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 64` (32+ characters) |
| `STORAGE_DRIVER` | `cloudinary` (with more than one API replica, `local` does not work) |
| `CLOUDINARY_*` | Your credentials |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Your SMTP provider |
| `MAIL_FROM` | `CloudVault <no-reply@example.com>` on a verified domain |
| `MAX_UPLOAD_BYTES` | `10485760` on the Cloudinary Free plan |

`compose.prod.yaml` sets these for you: `NODE_ENV=production`, `CLIENT_URL=https://$DOMAIN`,
`COOKIE_SECURE=true` and `TRUST_PROXY=2`.

Put the RDS CA bundle at `prisma/rds-ca.pem`. The file is git-ignored; download it from
`https://truststore.pki.rds.amazonaws.com/eu-north-1/eu-north-1-bundle.pem`.

Check the configuration before starting:

```bash
npm run prod:config      # or: docker compose -f compose.yaml -f compose.prod.yaml config --quiet
```

## 3. Start

```bash
npm run prod:up          # docker compose -f compose.yaml -f compose.prod.yaml up --build -d
npm run prod:logs        # follow api, web and caddy logs
```

On the first start Caddy requests the certificate. That takes a few seconds once DNS points at
the server. Open `https://files.example.com`.

Without Node.js on the server, run the compose commands directly:
`docker compose -f compose.yaml -f compose.prod.yaml up --build -d`.

## 4. Create the admin accounts

The database starts with no users. Make a password hash inside the API container, then run
[database/create-admins.sql](../database/create-admins.sql) against RDS:

```bash
docker compose -f compose.yaml -f compose.prod.yaml run --rm --no-deps api \
  node scripts/hash-password.js "a-strong-password-1"
# paste the hashes into database/create-admins.sql, then:
mysql -h <rds-endpoint> -P 3306 -u <user> -p --ssl-ca=prisma/rds-ca.pem cloudvault < database/create-admins.sql
```

Sign in as the Super Admin and check **Admin > Overview**.

## 5. Updating

```bash
git pull
npm run prod:up
```

Compose rebuilds the images and `migrate` applies new migrations. The API containers are then
recreated. Each one finishes in-flight requests before it stops (graceful shutdown, 15 s grace period).

**Rolling back:** check out the previous commit and run `npm run prod:up` again. Migrations
only move forward, so write schema changes that the previous release can still run against
(add columns first, remove them in a later release).

## 6. Operations

**Health checks**

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/v1/health/live` | The process is serving HTTP | Container health checks (already set in the Dockerfile) |
| `GET /api/v1/health/ready` (or `/api/v1/health`) | Database and storage are reachable (503 if not) | Load balancers, uptime monitors |

**Logs.** In production the API writes one JSON object per line, with `time`, `level`, `msg`,
`requestId` and, for errors, `err.stack`. Each response carries an `X-Request-Id` header, and 500
error bodies include `error.requestId`, so a user's report can be matched to the log line.
Docker rotates logs at 10 MB × 5 files per container. To ship them to CloudWatch, set the
`awslogs` logging driver in `compose.prod.yaml`.

**Backups.** All durable data is in RDS and Cloudinary.
- RDS: turn on automated backups (7+ days) and deletion protection. Take a manual snapshot before risky migrations.
- Cloudinary: files are kept until CloudVault deletes them (trash purge after `TRASH_RETENTION_DAYS`).
  On a paid plan, turn on Cloudinary's backup feature as well.
- The server only holds the `caddy-data` volume (certificates). If you lose it, Caddy simply requests new ones.

**Scaling.** `API_REPLICAS=4 npm run prod:up`. Keep `API_REPLICAS × connection_limit` (10 in
`DATABASE_URL`) below the RDS instance's `max_connections`. For more than one server, move
Redis to ElastiCache (`DOCKER_REDIS_URL=rediss://...`) and put a load balancer in front of
several servers that all run the same compose stack.

**Security checklist**

- [ ] RDS **Public access = No**; port 3306 only from the server's security group
- [ ] Only ports 22 (ideally limited to your IP), 80 and 443 open on the server
- [ ] `.env` is `chmod 600` and never committed
- [ ] The database user in `DATABASE_URL` only has privileges on the `cloudvault` schema
- [ ] Automated OS security updates (`unattended-upgrades` on Ubuntu)
- [ ] An uptime monitor on `https://<DOMAIN>/api/v1/health/ready`

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid environment configuration` in the api logs | The message lists each setting to fix. Edit `.env`, then run `npm run prod:up` again |
| `Set DOMAIN in .env` when starting | `DOMAIN` and `ACME_EMAIL` must be set for the production overlay |
| Browser shows a certificate error | DNS does not point at the server yet, or port 80/443 is closed. Check `docker compose -f compose.yaml -f compose.prod.yaml logs caddy` |
| `!reset` error from compose | Upgrade Docker Compose to v2.24 or newer |
| Every request shows the same client IP in the activity log | Something else is in front of Caddy (e.g. an AWS ALB). Raise `TRUST_PROXY` in `compose.prod.yaml` by one per extra proxy |
| Emails are not arriving | Check the api logs for `Failed to send email`, and that `MAIL_FROM` is on a domain your SMTP provider has verified |
