import { withSentryConfig } from "@sentry/nextjs";

/* global process, Buffer */

/** Origin of a configured URL, or null when unset/invalid. */
function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Clerk's Frontend API origin, encoded in the publishable key (pk_<env>_<base64 "host$">). */
function clerkFrontendApi() {
  const encoded = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").split(
    "_",
  )[2];
  if (!encoded) return null;
  const host = Buffer.from(encoded, "base64")
    .toString("utf8")
    .replace(/\$$/, "");
  return originOf(`https://${host}`);
}

const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = originOf(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
);
const clerk = clerkFrontendApi();
const turnstile = "https://challenges.cloudflare.com"; // Clerk bot protection
const clerkTelemetry = "https://clerk-telemetry.com"; // sent by Clerk development instances
// Vercel injects its feedback toolbar into preview deployments only.
const vercelLive =
  process.env.VERCEL_ENV === "preview" ? "https://vercel.live" : null;
const sentry = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);
const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const widget = originOf(process.env.NEXT_PUBLIC_WIDGET_URL);
const apiSocket = apiOrigin?.replace(/^http/, "ws");
const clerkImages = "https://img.clerk.com"; // user avatars
// This deployment's own origin. Vercel otherwise sends
// `Access-Control-Allow-Origin: *` on cached pages, inviting any site to read them.
const selfOrigin = originOf(
  process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null,
);

// The CSP is fixed at build time. A missing origin is silently left out and the
// browser then blocks that service, so say so loudly in a production build.
if (!isDev) {
  for (const [name, origin] of [
    ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerk],
    ["NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL ? apiOrigin : null],
  ]) {
    if (!origin)
      console.warn(
        `[csp] ${name} is missing or invalid; the dashboard CSP will block it.`,
      );
  }
}

const csp = {
  "default-src": ["'self'"],
  // Next's inline bootstrap needs 'unsafe-inline' without nonces; nonces would force
  // every page to render dynamically. Dev adds 'unsafe-eval' for React refresh.
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    isDev && "'unsafe-eval'",
    clerk,
    turnstile,
    vercelLive,
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  // Images: our own files and uploads (storage), plus Clerk avatars and widgets.
  "img-src": ["'self'", "data:", "blob:", supabase, clerk, clerkImages],
  "connect-src": [
    "'self'",
    apiOrigin,
    apiSocket,
    clerk,
    clerkTelemetry,
    sentry,
    supabase,
    vercelLive,
  ],
  "media-src": ["'self'", "blob:", "data:"],
  "worker-src": ["'self'", "blob:"],
  "frame-src": ["'self'", turnstile, widget, vercelLive],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
};
const contentSecurityPolicy = Object.entries(csp)
  .map(([directive, sources]) =>
    [directive, ...sources.filter(Boolean)].join(" "),
  )
  .join("; ");

// Vercel only adds HSTS; the rest of the baseline security headers are ours.
// frame-ancestors/SAMEORIGIN still allow the dashboard's own srcdoc previews.
// microphone=(self) keeps the voice preview working.
const securityHeaders = [
  // Set explicitly: not every edge server added HSTS on its own.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(selfOrigin
    ? [{ key: "Access-Control-Allow-Origin", value: selfOrigin }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  transpilePackages: ["@repo/validation"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  hideSourceMaps: true,
});
