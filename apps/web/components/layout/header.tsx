'use client';

import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { usePageHeader } from './page-header';
import { HeaderNotifications, HeaderUser } from './header-user';

export function Header() {
  const { title, actions } = usePageHeader();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        {title}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      <Separator orientation="vertical" className="mx-1 h-4" />
      <HeaderNotifications />
      <HeaderUser />
    </header>
  );
}
