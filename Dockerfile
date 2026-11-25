# CloudVault container images (one Dockerfile, three targets):
#   api      Node.js API + Socket.IO. Production dependencies only; runs as the "node" user.
#            Stateless: run as many replicas as needed.
#   migrate  Applies Prisma migrations and seeds roles/permissions (idempotent), then exits.
#            compose runs it once before any api replica starts.
#   web      nginx serving the built React app and proxying /api and /socket.io to the api.
#
# Configuration comes from .env at runtime (env_file), so no secrets are baked into images.

# Node 22 LTS (Node 20 reached end of life in April 2026).
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- base: OS packages every Node stage needs ---------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL; ca-certificates for TLS to RDS, Cloudinary and SMTP.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- deps: every workspace's dependencies (build tools included) --------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# postinstall runs "prisma generate", which needs the schema
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# ---- prod-deps: only what the API needs at runtime ------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# --ignore-scripts skips "prisma generate" (the CLI is a dev dependency); the generated
# client is copied from the deps stage instead. bcrypt ships prebuilt binaries.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w backend \
  && mkdir -p backend/node_modules \
  && npm cache clean --force
COPY --from=deps /app/node_modules/.prisma node_modules/.prisma

# ---- web build: compile the React app --------------------------------------------
FROM deps AS web-build
COPY frontend frontend
RUN npm run build -w frontend

# ---- migrate -------------------------------------------------------------------------
FROM deps AS migrate
ENV NODE_ENV=production
COPY prisma prisma
USER node
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node prisma/seed.js"]

# ---- api ---------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/backend/node_modules backend/node_modules
COPY package.json ./
COPY backend backend
# schema.prisma (Prisma resolves sslcert= paths relative to it) and the RDS CA bundle
COPY prisma prisma
# hash-password.js, for database/create-admins.sql:
#   docker compose run --rm api node scripts/hash-password.js "password"
COPY scripts scripts
RUN mkdir -p storage/tmp storage/uploads storage/versions && chown -R node:node /app/storage
USER node
EXPOSE 4000
# Liveness only (no database round trip), so a short outage does not restart every replica.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]

# ---- web ---------------------------------------------------------------------------
# 1.28+: upstream "server ... resolve" (re-resolves scaled api replicas)
FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
