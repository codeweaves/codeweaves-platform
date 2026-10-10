import * as Sentry from "@sentry/nextjs";

/**
 * Next.js loads this file at server start (Next 15+). @sentry/nextjs 10 only
 * initialises from here: a bare `sentry.server.config.ts` / `sentry.edge.config.ts`
 * is never loaded on its own, so without this file the dashboard reported nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Errors thrown in Server Components, route handlers and middleware.
export const onRequestError = Sentry.captureRequestError;
