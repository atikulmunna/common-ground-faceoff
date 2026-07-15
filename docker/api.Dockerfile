FROM node:22-bookworm-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci

COPY tsconfig.base.json turbo.json ./
COPY apps/api apps/api
COPY packages/config packages/config
COPY packages/shared packages/shared

RUN npm -w @common-ground/api run prisma:generate
RUN npx esbuild apps/api/src/index.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --alias:@common-ground/shared=./packages/shared/src/index.ts \
    --alias:@common-ground/config=./packages/config/index.ts \
    --outfile=apps/api/dist/container.mjs
RUN npx esbuild apps/api/src/jobs/retentionJob.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --packages=external \
    --outfile=apps/api/dist/retention-job.mjs
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4100 \
    API_PROCESS_ROLE=all

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/apps/api/dist/container.mjs ./apps/api/dist/container.mjs
COPY --chown=node:node --from=builder /app/apps/api/dist/retention-job.mjs ./apps/api/dist/retention-job.mjs
COPY --chown=node:node --from=builder /app/apps/api/prisma ./apps/api/prisma

EXPOSE 4100
USER node
CMD ["node", "apps/api/dist/container.mjs"]
