'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Settings } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { useInboxCount } from '@/hooks/use-handover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Notifications bell in the top bar. Surfaces the live "waiting for a human"
 * inbox count and links straight to the Inbox. Hidden count at zero.
 */
export function HeaderNotifications() {
  const count = useInboxCount();
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative text-foreground [&_svg]:size-4.5"
    >
      <Link
        href="/dashboard/inbox"
        aria-label={
          count
            ? `Inbox: ${count} conversation${count === 1 ? '' : 's'} waiting for a human`
            : 'Inbox'
        }
      >
        <Bell />
        {count > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums ring-2 ring-background">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Link>
    </Button>
  );
}

/**
 * Account avatar + dropdown, moved out of the sidebar and into the top bar so
 * the sidebar carries only navigation.
 */
export function HeaderUser() {
  const router = useRouter();
  const { user: clerkUser, logout, isAuthenticated } = useAuth();
  const { profile } = useProfile();

  if (!isAuthenticated || !clerkUser) return null;

  const email = profile?.email || clerkUser.email || '';
  // Prefer the backend profile name; fall back to the Clerk user's name.
  const name = profile?.name || clerkUser.name || null;

  const initials =
    name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase() || email[0]?.toUpperCase() || '?';

  const roleLabel = profile?.role
    ? profile.role.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex cursor-pointer items-center rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 rounded-lg" align="end" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name || email}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
              {roleLabel && (
                <span className="truncate text-xs text-muted-foreground/70">
                  {roleLabel}
                </span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => router.push('/dashboard/profile-settings')}
          >
            <Settings />
            Profile Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut />
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
