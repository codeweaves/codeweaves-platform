# API image for Google Cloud Run. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t klivo-api .
# Migrations are not run here; CI applies them before the deploy.

ARG NODE_IMAGE=node:24.21.0-trixie-slim
ARG BUN_IMAGE=oven/bun:1.3.9

FROM ${BUN_IMAGE} AS bun

# Workspace manifests only, so the install layers cache until a manifest changes.
# Every workspace is listed because --frozen-lockfile checks them all.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/widget/package.json apps/widget/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/jest-config/package.json packages/jest-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/validation/package.json packages/validation/

FROM manifests AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN bun install --frozen-lockfile --linker hoisted --filter @repo/api --filter @repo/validation
COPY packages/typescript-config packages/typescript-config
COPY packages/validation packages/validation
COPY apps/api apps/api
RUN cd packages/validation && bun run build
RUN cd apps/api && bun run prisma generate && bun run build

# Runtime dependencies only. The generated Prisma client comes from the build stage.
FROM manifests AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN bun install --frozen-lockfile --production --linker hoisted --filter @repo/api
COPY --from=build /app/node_modules/.prisma node_modules/.prisma

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
WORKDIR /app
# The filesystem is read-only for the nonroot user, so no AI trace log file.
ENV NODE_ENV=production PORT=8080 AI_TRACE_LOG_FILE=0
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/validation/package.json packages/validation/package.json
COPY --from=build /app/packages/validation/dist packages/validation/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
# The distroless nonroot user, declared explicitly.
USER 65532:65532
EXPOSE 8080
CMD ["dist/main.js"]
