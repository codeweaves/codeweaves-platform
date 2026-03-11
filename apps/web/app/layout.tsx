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
