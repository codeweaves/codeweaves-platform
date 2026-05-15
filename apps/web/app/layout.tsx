import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Auth0ProviderWrapper } from "@/providers/auth0-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ApiGate } from "@/providers/api-gate";
import { SentryUserProvider } from "@/providers/sentry-user-provider";
import { Toaster } from "@/components/ui/sonner";
import { NavigationProgress } from "@/components/layout/navigation-progress";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "CodeWeaves",
  description: "AI Chat Widget Platform - Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
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
            <Auth0ProviderWrapper>
              <SentryUserProvider>
                <NavigationProgress />
                {children}
                <Toaster />
              </SentryUserProvider>
            </Auth0ProviderWrapper>
          </ApiGate>
        </QueryProvider>
      </body>
    </html>
  );
}
