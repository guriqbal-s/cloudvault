# CloudVault on Amazon RDS for MySQL

Use an RDS for MySQL 8.4 instance. In the RDS console, open your instance’s **Connectivity & security** tab for the endpoint and port. Use the database user and password configured for that instance. Its security group must allow the application host to reach the MySQL port, normally TCP 3306. [RDS connection details](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToInstance.EndpointAndPort.html)

## Configure the connection

1. Install the Node dependencies with `npm ci`.
2. Copy `.env.example` to `.env` if you do not already have one. Replace the RDS placeholders in the active `DATABASE_URL` and set the database name and port to match your instance. Percent-encode special characters in the username and password, for example `@` becomes `%40`. Generate a random `JWT_ACCESS_SECRET` if the file still has the example value.
3. Use the AWS RDS root CA bundle at `prisma/rds-ca.pem`. If the file is missing, download the bundle for your instance's AWS Region and save it there. The global bundle covers commercial AWS Regions. Prisma uses the CA and `sslaccept=strict` to verify the TLS connection. [AWS certificate bundles](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions) · [Prisma MySQL connection settings](https://www.prisma.io/docs/orm/v6/overview/databases/mysql#connection-details)

```dotenv
DATABASE_URL="mysql://YOUR_DB_USER:YOUR_DB_PASSWORD@database-1.cryam8ioiwyg.eu-north-1.rds.amazonaws.com:3306/cloudvault?sslcert=rds-ca.pem&sslaccept=strict&connect_timeout=15&connection_limit=10"
```

## Apply the schema

```bash
npm run db:setup
# then run database/create-admins.sql to create the Super Admin and Admin accounts
npm run db:check
npm run dev          # or: npm run docker:up  (http://localhost:8080)
```

`db:setup` applies the checked-in MySQL migrations and seeds roles and permissions. The migration user needs schema change privileges and permission to create the database if it is missing. You can also set the initial database name when provisioning RDS.

The MySQL migration initializes a new schema. Moving data from an existing PostgreSQL installation requires a separate data import.

## Current instance

| Setting | Value |
|---|---|
| Endpoint | `database-1.cryam8ioiwyg.eu-north-1.rds.amazonaws.com` |
| Port | `3306` |
| Region | `eu-north-1` (CA bundle: `prisma/rds-ca.pem`, from https://truststore.pki.rds.amazonaws.com/eu-north-1/eu-north-1-bundle.pem) |

The Docker `api` container connects with the same `DATABASE_URL`; the CA file is copied into the image.
