import * as Sentry from "@sentry/nestjs";
import { scrubSentryEvent } from "./common/sentry/sentry.scrubber";

/**
 * Sentry init. main.ts imports this FIRST, before Nest or any other module
 * loads: the SDK's automatic instrumentation (http, express, Prisma) can only
 * patch modules that are loaded after `Sentry.init`. Error capture works
 * either way; tracing and request context need this order.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    maxBreadcrumbs: 25,
    beforeSend: scrubSentryEvent,
    // Performance tracing (p50/p95 per route in Sentry). Off unless set, so
    // turning it on in prod is an env change: SENTRY_TRACES_SAMPLE_RATE=0.1.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0) || 0,
    // Source maps are uploaded via sentry-cli in CI (see SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT env vars)
    // This tells the SDK to look for them when symbolizing stack traces
    ...(process.env.NODE_ENV === "production" && {
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
    }),
  });
}
