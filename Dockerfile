# ====================================================================
# DevCollab Production Cloud Deployment Dockerfile (Multi-stage)
# ====================================================================

# --------------------------------------------------------------------
# Stage 1: Builder
# --------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/

RUN npm ci

COPY packages/shared packages/shared/
COPY apps/client apps/client/
COPY apps/server apps/server/

# Generate Prisma Client & compile all packages
RUN npm run db:generate
RUN npm run build

# --------------------------------------------------------------------
# Stage 2: Production Runtime
# --------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000
ENV YJS_WS_PORT=10000
ENV SINGLE_PORT=true
ENV EXECUTION_BACKEND=piston

RUN apk add --no-cache libc6-compat

# Copy package descriptors
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma/

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma Client for runtime
RUN npm run db:generate

# Copy built distribution bundles
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/client/dist ./apps/client/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist

EXPOSE 10000

CMD ["sh", "-c", "npm run db:deploy && npm start"]
