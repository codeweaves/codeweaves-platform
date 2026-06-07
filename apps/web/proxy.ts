import { clerkMiddleware } from '@clerk/nextjs/server';

// Next.js 16 renamed the middleware entrypoint to `proxy.ts`. Clerk only needs
// `clerkMiddleware()` mounted here so its hooks/`auth()` work app-wide — we do
// NOT protect routes at the edge. Access control stays where it already lives:
// the client-side <AuthGuard> for the dashboard, and JWT verification + DB-driven
// RBAC on the NestJS API (the real security boundary).
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
