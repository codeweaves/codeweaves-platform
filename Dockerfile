# syntax=docker/dockerfile:1.7

# ---------- Builder ----------
# Bun for install + Prisma generate + Nest build (matches local toolchain)
FROM oven/bun:1.3.8 AS builder

WORKDIR /app

# Workspace package manifests first, for better layer caching.
# bun workspaces require every workspace's package.json to be present
# before `bun install`, even ones we don't deploy.
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json   ./apps/api/
COPY apps/web/package.json   ./apps/web/
COPY apps/widget/package.json ./apps/widget/
COPY packages ./packages

# Install all deps. --ignore-scripts mirrors the working Render build:
# skips native postinstalls (cpu-features, @sentry/profiling-node) that
# break or aren't needed in a server container.
RUN bun install --frozen-lockfile --ignore-scripts

# Now copy source. Doing this after install means edits to source don't
# invalidate the (slow) install layer.
COPY . .

# Generate Prisma client (engine binaries land in node_modules)
RUN cd apps/api && ./node_modules/.bin/prisma generate

# Build only @repo/api (turbo will build its workspace deps via ^build)
RUN ./node_modules/.bin/turbo run build --filter=@repo/api

# Sanity check — fail fast if the expected entrypoint isn't where we expect
RUN test -f apps/api/dist/src/main.js \
  || (echo "ERROR: apps/api/dist/src/main.js not found" && ls -la apps/api/dist && exit 1)


# ---------- Runner ----------
# Node (not Bun) for runtime: Prisma's CLI shim is `#!/usr/bin/env node`,
# and Nest's compiled JS runs cleanly on Node. Smaller surface area.
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Prisma engines need OpenSSL + CA certs at runtime
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy node_modules from builder (already hoisted by bun workspaces).
# We bring root + apps/api modules; packages/ contains workspace source
# which bun symlinks into node_modules/@repo/*.
COPY --from=builder /app/node_modules           ./node_modules
COPY --from=builder /app/apps/api/node_modules  ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist          ./apps/api/dist
COPY --from=builder /app/apps/api/prisma        ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json  ./apps/api/package.json
COPY --from=builder /app/packages               ./packages
COPY --from=builder /app/package.json           ./package.json

# Fly will inject PORT; main.ts already honors process.env.PORT.
EXPOSE 3001

# Run the Nest entrypoint
CMD ["node", "apps/api/dist/src/main.js"]
