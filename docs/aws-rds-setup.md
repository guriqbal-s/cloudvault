# Connecting CloudVault to AWS RDS (PostgreSQL)

You do **not** need PostgreSQL installed on your computer. The app, the migrations and the
seed script all talk to RDS over the network using `DATABASE_URL` in `.env`.

Time needed: about 15 minutes (most of it is RDS creating the instance).

---

## 1. Create the RDS instance

AWS Console → **RDS** → **Create database**.

| Setting | Value |
|---|---|
| Creation method | Standard create |
| Engine | **PostgreSQL**, version 16 or 17 (anything 14+ works) |
| Templates | **Free tier** (or Dev/Test) |
| DB instance identifier | `cloudvault-db` |
| Master username | `postgres` (or any name) |
| Credentials management | Self managed → set a master password and **write it down** |
| Instance class | `db.t4g.micro` / `db.t3.micro` (free tier eligible) |
| Storage | 20 GiB gp3, autoscaling optional |
| Compute resource | Don't connect to an EC2 compute resource |
| **Public access** | **Yes** (required to connect from your own PC) |
| VPC security group | Create new → name it `cloudvault-db-sg` |
| Database authentication | Password authentication |
| Additional configuration → Initial database name | `cloudvault` (optional: `db:setup` creates it if missing) |

Click **Create database** and wait until the status is **Available**.

> **Production tip:** when the API runs on AWS (EC2, ECS, Elastic Beanstalk) set Public access to
> **No** and allow port 5432 only from the API's security group instead of your IP.

## 2. Allow your IP through the security group

RDS → your instance → **Connectivity & security** → click the VPC security group →
**Edit inbound rules** → **Add rule**:

- Type: **PostgreSQL** (TCP 5432)
- Source: **My IP**

Save. If your home IP changes later, update this rule. That's the usual reason for "can't reach the database".

## 3. Put the connection string in `.env`

Copy the **Endpoint** from *Connectivity & security*, for example
`cloudvault-db.abc123xyz.us-east-1.rds.amazonaws.com`.

If you don't have a `.env` yet, run `npm run setup:local` once or copy `.env.example` to `.env`.

In `.env`, comment out the local `DATABASE_URL` line and add your RDS line. Only one line may be active:

```dotenv
# DATABASE_URL="postgresql://postgres:postgres@localhost:5433/cloudvault?schema=public"
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@cloudvault-db.abc123xyz.us-east-1.rds.amazonaws.com:5432/cloudvault?schema=public&sslmode=require&connect_timeout=15&connection_limit=10"
```

Make sure `JWT_ACCESS_SECRET` is a long random value (`setup:local` generates one for you), not the
`change-me` placeholder.

**Password with special characters?** Characters like `@ : / ? # % &` break the URL. Encode it:

```bash
node -e "console.log(encodeURIComponent(process.argv[1]))" "my@pa:ss"
# -> my%40pa%3Ass   (paste this into DATABASE_URL)
```

## 4. Test the connection

```bash
npm install
npm run db:check
```

Expected output:

```
  ✔ Connected: PostgreSQL 16.x on aarch64-unknown-linux-gnu
  ✔ Connection is encrypted (SSL)
  ✔ pg_trgm extension is available (needed for fast search)
  ! No tables yet. Next step:  npm run db:setup
```

## 5. Create the tables and demo data

```bash
npm run db:setup
```

This creates the `cloudvault` database if needed, writes the initial migration to
`prisma/migrations/`, applies it, and seeds demo accounts. Then:

```bash
npm run dev
```

Open http://localhost:5173 and sign in as `alice@cloudvault.dev` / `CloudVault#2026`.

For a real deployment, use `npm run db:setup:prod` instead: it seeds roles and permissions
only, with no demo users. Later schema changes are applied with `npm run db:deploy`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot reach the database server` / timeout | Security group inbound rule for **My IP** on 5432; instance **Publicly accessible = Yes**; status Available; some office/school networks block port 5432 (try a phone hotspot). |
| `Authentication failed` | Wrong master username/password, or the password has special characters that aren't URL-encoded. RDS → Modify lets you reset the master password. |
| `no pg_hba.conf entry ... no encryption` | Add `sslmode=require` to `DATABASE_URL`. |
| `Database "cloudvault" does not exist` | `npm run db:check -- --create` (or just `npm run db:setup`). |
| `too many connections` on a micro instance | Lower `connection_limit` in `DATABASE_URL` (5 is plenty for development). |
| `P3005 The database schema is not empty` | The database already has tables from elsewhere. Use an empty database, or run `npm run db:reset` (**deletes all data**). |

## Cost notes

- The free tier covers 750 hours/month of a micro instance plus 20 GB storage for 12 months on eligible accounts.
- A public IPv4 address is billed separately (about $3.60/month).
- **Stop** the instance from the RDS console when you're not using it. AWS starts it again automatically after 7 days.
- Delete the instance when you're done with it (you can take a final snapshot).

## Strict certificate verification (optional)

`sslmode=require` encrypts the connection but doesn't verify the server's certificate. To verify it,
download the RDS CA bundle (`global-bundle.pem`) from
https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html and use an
**absolute** path to it:

```
...?schema=public&sslmode=require&sslaccept=strict&sslcert=C:/path/to/global-bundle.pem
```
