'use client';

import { AppSidebar } from './sidebar';
import { Header } from './header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="flex-1 overflow-auto bg-gray-50 p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
