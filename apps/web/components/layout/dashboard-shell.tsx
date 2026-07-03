'use client';

import { useEffect, useRef } from 'react';
import { AppSidebar } from './sidebar';
import { Header } from './header';
import { PageHeaderProvider } from './page-header';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { useProfile } from '@/hooks/use-profile';
import { useHandoverRealtime } from '@/hooks/use-handover';

interface DashboardShellProps {
  children: React.ReactNode;
}

/**
 * Restores the full sidebar when the viewport returns to a desktop width.
 *
 * Below the mobile breakpoint the sidebar becomes an off-canvas sheet; a desktop
 * icon-collapse (`open=false`) otherwise carries over and leaves the sidebar
 * stuck as a thin rail after you widen the window again (only a reload cleared
 * it, since the shell defaults to expanded on mount). We only act on a genuine
 * mobile→desktop transition, so a normal in-session collapse still works.
 */
function SidebarViewportSync() {
  const { isMobile, setOpen } = useSidebar();
  const wasMobile = useRef(isMobile);
  useEffect(() => {
    if (wasMobile.current && !isMobile) {
      setOpen(true);
    }
    wasMobile.current = isMobile;
  }, [isMobile, setOpen]);
  return null;
}

export function DashboardShell({ children }: DashboardShellProps) {
  // Mount the org realtime socket for the ENTIRE dashboard so the sidebar Inbox
  // flag lights up the instant a visitor asks for a human — on any page, not
  // just the Inbox. The React Query poll is only a backstop now.
  const { profile } = useProfile();
  useHandoverRealtime(profile);

  return (
    <PageHeaderProvider>
      <SidebarProvider>
        <SidebarViewportSync />
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
          <div className="thin-scroll flex-1 overflow-auto bg-background">
            <div className="mx-auto min-w-270 max-w-440 px-8 py-7">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </PageHeaderProvider>
  );
}
