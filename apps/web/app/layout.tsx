import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { QueryProvider } from "@/providers/query-provider";
import { ApiGate } from "@/providers/api-gate";
import { SentryUserProvider } from "@/providers/sentry-user-provider";
import { Toaster } from "@/components/ui/sonner";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { LegacyAuthCleanup } from "@/components/features/auth/legacy-auth-cleanup";
import { AuthCacheReset } from "@/components/features/auth/auth-cache-reset";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Klivo",
  description:
    "Klivo is an enterprise agentic AI platform to build, deploy, and manage AI agents across voice, chat, and more.",
  icons: {
    icon: [
      // Default (navy mark): light browser chrome + fallback for browsers that
      // ignore the prefers-color-scheme media hint on favicons.
      { url: "/klivo-logo-remove.png" },
      // Dark browser chrome: the navy mark is low-contrast, so swap to white.
      { url: "/klivo-logo-white.png", media: "(prefers-color-scheme: dark)" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Fonts referenced by the chat widget theme picker. Loaded once in the
            root layout (app router) so they are resolvable by their real CSS
            family names ("Inter", "Open Sans", "Roboto") in the preview and any
            embedded widget surface — next/font would expose them only under a
            generated unique family name, which would not match saved themes. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Open+Sans:wght@400;500;600;700&family=Roboto:wght@400;500;700&display=swap"
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <QueryProvider>
          <ApiGate>
            <SentryUserProvider>
              <LegacyAuthCleanup />
              <AuthCacheReset />
              <NavigationProgress />
              {children}
              <Toaster />
            </SentryUserProvider>
          </ApiGate>
        </QueryProvider>
      </body>
      </html>
    </ClerkProvider>
  );
}
