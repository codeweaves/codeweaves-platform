import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    beforeSend(event) {
      // Strip Authorization header from request breadcrumbs
      if (event.breadcrumbs) {
        for (const breadcrumb of event.breadcrumbs) {
          if (breadcrumb.data?.headers) {
            delete breadcrumb.data.headers['Authorization'];
            delete breadcrumb.data.headers['authorization'];
          }
        }
      }

      // Strip cookies from request data
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['Cookie'];
          delete event.request.headers['cookie'];
        }
      }

      // Strip sensitive fields from extras and contexts
      const sensitiveKeys = ['password', 'token', 'secret'];
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
            delete event.extra[key];
          }
        }
      }
      if (event.contexts) {
        for (const contextKey of Object.keys(event.contexts)) {
          const ctx = event.contexts[contextKey];
          if (ctx && typeof ctx === 'object') {
            for (const key of Object.keys(ctx)) {
              if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
                delete (ctx as Record<string, unknown>)[key];
              }
            }
          }
        }
      }

      return event;
    },

    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-extension:\/\//i,
    ],
  });
}
