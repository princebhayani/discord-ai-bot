# ==============================================================================
# Multi-Stage Production Dockerfile for @hrbot/bot (Northflank Persistent Worker)
# ==============================================================================
# Lightweight Node 22 LTS Alpine image containing ONLY @hrbot/bot and @hrbot/shared.
# Requires NO inbound public HTTP port in normal operation (outbound Gateway/HTTPS only).
# ==============================================================================

FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

# Copy all workspace manifests so pnpm --frozen-lockfile validates cleanly
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

# Install root build toolchain + shared + bot dependencies (skips dashboard packages)
RUN pnpm install --frozen-lockfile --filter . --filter @hrbot/shared --filter @hrbot/bot

# Copy TypeScript sources and compile
COPY packages/shared ./packages/shared
COPY apps/bot ./apps/bot

RUN pnpm --filter @hrbot/shared build && pnpm --filter @hrbot/bot build

# Strip TypeScript sources and prune devDependencies before copying to runner
RUN rm -rf packages/shared/src apps/bot/src \
 && pnpm install --frozen-lockfile --prod --filter @hrbot/shared --filter @hrbot/bot

# ------------------------------------------------------------------------------
# Stage 2: Minimal Non-Root Production Runner
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

# dumb-init ensures clean PID 1 signal forwarding (SIGTERM / SIGINT) on Northflank
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/shared ./packages/shared
COPY --from=builder --chown=node:node /app/apps/bot ./apps/bot

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/bot/dist/index.js"]
