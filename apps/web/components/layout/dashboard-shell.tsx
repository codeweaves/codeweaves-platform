'use client';

import { AppSidebar } from './sidebar';
import { Header } from './header';
import { PageHeaderProvider } from './page-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <PageHeaderProvider>
      <SidebarProvider>
        <AppSidebar />
        {/* min-w-0 lets the inset shrink below the content's min-width so the
         * horizontal scroll is contained inside <main> (below) rather than
         * overflowing the body — otherwise the fixed sidebar floats over the
         * sideways-scrolled content. */}
        <SidebarInset className="min-w-0">
          <Header />
          {/* Fixed-width dashboard: content floors at ~1080px and scrolls
           * sideways on narrow screens instead of reflowing responsively
           * (it's a dashboard, not a mobile app). Centered + capped on
           * ultrawide so it never stretches into sparse, hard-to-scan rows. */}
          {/* SidebarInset already renders the <main> landmark; this is just the
           * scroll container, so keep it a <div> to avoid nested <main>. */}
          <div className="flex-1 overflow-auto bg-background">
            <div className="mx-auto min-w-270 max-w-440 px-8 py-7">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderProvider>
  );
}
