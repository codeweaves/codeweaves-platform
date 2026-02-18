'use client';

import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { usePageHeader } from './page-header';

export function Header() {
  const { title, actions } = usePageHeader();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-white px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="min-w-0 flex-1 text-lg font-semibold">{title}</div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
