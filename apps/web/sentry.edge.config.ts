import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,

    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['Authorization'];
          delete event.request.headers['authorization'];
          delete event.request.headers['Cookie'];
          delete event.request.headers['cookie'];
        }
      }

      const sensitiveKeys = ['password', 'token', 'secret'];
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
            delete event.extra[key];
          }
        }
      }

      return event;
    },
  });
}
