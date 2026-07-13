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
COPY apps/web apps/web
COPY packages/config packages/config
COPY packages/shared packages/shared

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4100
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm -w @common-ground/web run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
