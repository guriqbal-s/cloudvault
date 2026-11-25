# CloudVault container images (one Dockerfile, two targets):
#   api  Node.js API + Socket.IO (stateless; run as many replicas as needed).
#        compose.yaml also runs this image once as "migrate" to apply Prisma migrations.
#   web  nginx serving the built React app and proxying /api and /socket.io to the api
#
# Built by compose.yaml (docker compose up --build). Configuration comes from .env at
# runtime (env_file), so no secrets are baked into the images.

ARG NODE_IMAGE=node:20-bookworm-slim

# ---- deps: install every workspace's dependencies once -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Prisma's query engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# postinstall runs "prisma generate", which needs the schema
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# ---- web build: compile the React app --------------------------------------------
FROM deps AS web-build
COPY frontend frontend
RUN npm run build -w frontend

# ---- api ---------------------------------------------------------------------------
FROM deps AS api
COPY backend backend
COPY prisma prisma
COPY scripts scripts
RUN mkdir -p storage/tmp storage/uploads storage/versions && chown -R node:node /app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(()=>process.exit(0),()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]

# ---- web ---------------------------------------------------------------------------
# 1.28+: upstream "server ... resolve" (re-resolves scaled api replicas)
FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
