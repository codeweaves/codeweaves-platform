'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Bot,
  Building2,
  BarChart3,
  MessageSquare,
  Inbox,
  Database,
  Users,
  Wrench,
  UserCog,
  ChevronRight,
} from 'lucide-react';
import { usePermissions } from '@/hooks/use-permissions';
import { useInboxCount } from '@/hooks/use-handover';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /**
   * Permission that unlocks this entry, or 'all' for anyone signed in.
   *
   * Gates on a permission rather than a role list so the nav follows the API
   * automatically: change what a role grants and this needs no edit. Hiding an
   * entry is UX only, since every page behind it is enforced server-side.
   */
  requires: 'all' | string;
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, requires: 'all' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, requires: 'Organization:ReadAll' },
  { name: 'Agents', href: '/dashboard/agents', icon: Bot, requires: 'Agent:Read' },
  { name: 'Conversations', href: '/dashboard/conversations', icon: MessageSquare, requires: 'ChatSession:Read' },
  { name: 'Inbox', href: '/dashboard/inbox', icon: Inbox, requires: 'Handover:Read' },
  { name: 'Collected Data', href: '/dashboard/collected-data', icon: Database, requires: 'CollectedData:Read' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, requires: 'Analytics:Read' },
  { name: 'Team', href: '/dashboard/team', icon: Users, requires: 'Member:Read' },
  { name: 'Users', href: '/dashboard/users', icon: UserCog, requires: 'User:ReadAll' },
  // Platform-owner tooling (email template copy, etc.) — not customer-facing.
  { name: 'Utilities', href: '/dashboard/utilities/email', icon: Wrench, requires: 'EmailTemplate:Read' },
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

export function AppSidebar() {
  const pathname = usePathname();
  const { can } = usePermissions();

  // Inbox is always present; if no bot has takeover on, the page itself shows
  // an empty state. (Conditionally hiding the nav left it stale until reload.)
  const visibleNavigation = navigation.filter(
    (item) => item.requires === 'all' || can(item.requires),
  );

  return (
    <Sidebar
      collapsible="icon"
      variant="inset"
      className="[&_[data-slot=sidebar-inner]]:rounded-xl [&_[data-slot=sidebar-inner]]:bg-background [&_[data-slot=sidebar-inner]]:shadow-sm"
    >
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
          <Image
            src="/klivo-logo-remove.png"
            alt="Klivo"
            width={32}
            height={32}
            priority
            className="size-8 shrink-0 object-contain"
          />
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
                      className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:shadow-sm data-[active=true]:hover:bg-primary data-[active=true]:hover:text-primary-foreground"
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

      <SidebarRail />
    </Sidebar>
  );
}
