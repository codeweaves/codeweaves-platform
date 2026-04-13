'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Bot,
  Building2,

  BarChart3,
  Settings,
  Users,
  ChevronsUpDown,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
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

  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: 'all' },
  { name: 'Team', href: '/dashboard/team', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

function NavUser() {
  const router = useRouter();
  const { user: auth0User, logout, isAuthenticated } = useAuth();
  const { profile } = useProfile();
  const { isMobile } = useSidebar();

  if (!isAuthenticated || !auth0User) return null;

  const email = profile?.email || auth0User.email || '';
  // Auth0 sets name to email when no real name exists — ignore that
  const auth0Name =
    auth0User.name && auth0User.name !== auth0User.email
      ? auth0User.name
      : null;
  const name = profile?.name || auth0Name;

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

  const visibleNavigation = navigation.filter((item) => {
    if (item.roles === 'all') return true;
    if (!userRole) return false;
    return item.roles.includes(userRole);
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-4">
        <span className="text-xl font-bold truncate group-data-[collapsible=icon]:hidden">
          CodeWeaves
        </span>
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
                        <ChevronRight className="ml-auto size-4 opacity-40" />
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
