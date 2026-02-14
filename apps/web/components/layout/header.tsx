'use client';

import { UserMenu } from '@/components/features/auth/user-menu';

export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <UserMenu />
      </div>
    </header>
  );
}
