'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Bot,
  Building2,
  BarChart3,
  MessageSquare,
  Inbox,
  Database,
  Settings,
  Users,
  ChevronsUpDown,
  ChevronRight,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { useInboxCount } from '@/hooks/use-handover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: 'all' | string[];
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: 'all' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Agents', href: '/dashboard/agents', icon: Bot, roles: 'all' },
  { name: 'Conversations', href: '/dashboard/conversations', icon: MessageSquare, roles: 'all' },
  { name: 'Inbox', href: '/dashboard/inbox', icon: Inbox, roles: 'all' },
  { name: 'Collected Data', href: '/dashboard/collected-data', icon: Database, roles: 'all' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: 'all' },
  { name: 'Team', href: '/dashboard/team', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

/**
 * Live count of conversations waiting for a human. Polls (+ realtime) in the
 * background so the flag is visible from any dashboard screen. Hidden at zero.
 */
function InboxNavBadge() {
  const count = useInboxCount();
  if (!count) return null;
  return (
    <>
      {/* Expanded: full count pill on the right of the row. */}
      <span className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums group-data-[collapsible=icon]:hidden">
        {count > 99 ? '99+' : count}
      </span>
      {/* Collapsed (icon-only): the pill is hidden, so show a dot on the icon
          corner (ringed to sit cleanly over the sidebar) — otherwise a waiting
          visitor is invisible until you expand the rail. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1 hidden size-2.5 rounded-full bg-destructive ring-2 ring-sidebar group-data-[collapsible=icon]:block"
      />
    </>
  );
}

function NavUser() {
  const router = useRouter();
  const { user: clerkUser, logout, isAuthenticated } = useAuth();
  const { profile } = useProfile();
  const { isMobile } = useSidebar();

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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {name || email}
                </span>
                {roleLabel && (
                  <span className="truncate text-xs text-sidebar-foreground/70">
                    {roleLabel}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {name || email}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {email}
                  </span>
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { profile } = useProfile();
  const userRole = profile?.role;

  // Inbox is always present; if no bot has takeover on, the page itself shows
  // an empty state. (Conditionally hiding the nav left it stale until reload.)
  const visibleNavigation = navigation.filter((item) => {
    if (item.roles === 'all') return true;
    if (!userRole) return false;
    return item.roles.includes(userRole);
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-[#1c315f] text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10">
            <Sparkles className="size-[1.05rem]" />
          </div>
          <span className="truncate text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Klivo
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavigation.map((item) => {
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);

                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.name}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span className="flex-1">{item.name}</span>
                        {item.href === '/dashboard/inbox' && <InboxNavBadge />}
                        <ChevronRight className="ml-auto size-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover/menu-item:translate-x-0 group-hover/menu-item:opacity-60 group-data-[collapsible=icon]:hidden" />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
