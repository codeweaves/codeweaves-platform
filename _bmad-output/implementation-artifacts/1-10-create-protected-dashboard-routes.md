# Story 1.10: Create Protected Dashboard Routes

Status: ready-for-dev

## Story

As a **dashboard developer**,
I want routes protected based on authentication,
So that only logged-in users can access the dashboard.

## Acceptance Criteria

1. **Given** Auth0 React SDK is integrated
   **When** user accesses protected route
   **Then** unauthenticated users are redirected to login

2. **And** authenticated users see the page content

3. **And** loading state is shown during auth check

4. **And** `/login` and `/callback` are public routes

## Tasks / Subtasks

- [ ] Task 1: Create AuthGuard component (AC: 1, 2, 3)
  - [ ] Create `components/auth/auth-guard.tsx`
  - [ ] Check authentication status
  - [ ] Redirect if not authenticated
  - [ ] Show loading state while checking

- [ ] Task 2: Create protected layout (AC: 1, 2)
  - [ ] Create `app/(protected)/layout.tsx`
  - [ ] Wrap with AuthGuard
  - [ ] Include dashboard shell (sidebar, header)

- [ ] Task 3: Create public routes (AC: 4)
  - [ ] Keep `/login` public
  - [ ] Keep `/callback` public
  - [ ] Keep `/signup` public
  - [ ] Keep `/reissue-invitation` public

- [ ] Task 4: Create dashboard pages
  - [ ] Create `/dashboard` home page
  - [ ] Create placeholder for other pages
  - [ ] All under protected layout

- [ ] Task 5: Create login page (AC: 4)
  - [ ] Redirect authenticated users to dashboard
  - [ ] Show login button for unauthenticated users

- [ ] Task 6: Test route protection
  - [ ] Test unauthenticated access redirects
  - [ ] Test authenticated access shows content
  - [ ] Test loading state displays
  - [ ] Test public routes accessible without auth

## Dev Notes

### AuthGuard Component

```typescript
// apps/web/components/auth/auth-guard.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, login } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Store current path for redirect after login
      login(pathname);
    }
  }, [isLoading, isAuthenticated, login, pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Redirecting to login...</span>
      </div>
    );
  }

  return <>{children}</>;
}
```

### Protected Layout

```typescript
// apps/web/app/(protected)/layout.tsx
import { AuthGuard } from '@/components/auth/auth-guard';
import { DashboardShell } from '@/components/layout/dashboard-shell';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardShell>
        {children}
      </DashboardShell>
    </AuthGuard>
  );
}
```

### Dashboard Shell

```typescript
// apps/web/components/layout/dashboard-shell.tsx
'use client';

import { Sidebar } from './sidebar';
import { Header } from './header';

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-gray-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

### Sidebar Component

```typescript
// apps/web/components/layout/sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Bot,
  Palette,
  BarChart3,
  Settings,
  Users,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Agents', href: '/dashboard/agents', icon: Bot },
  { name: 'Theme Editor', href: '/dashboard/theme', icon: Palette },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
  { name: 'Team', href: '/dashboard/team', icon: Users },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#333333] text-white">
      {/* Logo */}
      <div className="flex h-16 items-center px-6">
        <span className="text-xl font-bold">CodeWeaves</span>
      </div>

      {/* Navigation */}
      <nav className="mt-6 px-3">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

### Header Component

```typescript
// apps/web/components/layout/header.tsx
'use client';

import { UserMenu } from '@/components/auth/user-menu';

export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <div>
        {/* Breadcrumbs or page title could go here */}
      </div>
      <div className="flex items-center gap-4">
        <UserMenu />
      </div>
    </header>
  );
}
```

### Login Page

```typescript
// apps/web/app/login/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { LoginButton } from '@/components/auth/login-button';

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold">CodeWeaves</h1>
        <p className="mt-2 text-gray-600">AI Chat Widget Platform</p>
      </div>
      <LoginButton />
    </div>
  );
}
```

### Dashboard Home Page

```typescript
// apps/web/app/(protected)/dashboard/page.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome, {user?.name || 'User'}!</h1>
      <p className="mt-2 text-gray-600">
        This is your CodeWeaves dashboard. Manage your AI chat agents, customize themes, and view analytics.
      </p>

      {/* Dashboard content will be added in later epics */}
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <DashboardCard
          title="Agents"
          description="Manage your AI chat agents"
          href="/dashboard/agents"
        />
        <DashboardCard
          title="Theme Editor"
          description="Customize your widget appearance"
          href="/dashboard/theme"
        />
        <DashboardCard
          title="Analytics"
          description="View performance metrics"
          href="/dashboard/analytics"
        />
      </div>
    </div>
  );
}

function DashboardCard({ title, description, href }: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-gray-600">{description}</p>
    </a>
  );
}
```

### File Structure

```
apps/web/app/
├── layout.tsx                    # Root layout with Auth0Provider
├── page.tsx                      # Landing page (redirect to login/dashboard)
├── login/
│   └── page.tsx                  # Public - login page
├── callback/
│   └── page.tsx                  # Public - Auth0 callback
├── signup/
│   └── page.tsx                  # Public - invitation signup
├── reissue-invitation/
│   └── page.tsx                  # Public - reissue expired invitation
└── (protected)/
    ├── layout.tsx                # Protected layout with AuthGuard
    └── dashboard/
        ├── page.tsx              # Dashboard home
        ├── agents/
        │   └── page.tsx          # Agents list (placeholder)
        ├── theme/
        │   └── page.tsx          # Theme editor (placeholder)
        ├── analytics/
        │   └── page.tsx          # Analytics (placeholder)
        ├── team/
        │   └── page.tsx          # Team management (placeholder)
        └── settings/
            └── page.tsx          # Settings (placeholder)
```

### Architecture Compliance

- **ADR-003:** Next.js v16 for Dashboard - App Router
- **ADR-010:** Zustand + TanStack Query for State Management
- **UX Spec:** Dashboard specifications (sidebar #333333, Open Sans font)

### UI Specifications

| Element | Specification |
|---------|---------------|
| Sidebar width | 256px (w-64) |
| Sidebar color | #333333 |
| Active link | blue-600 bg |
| Header height | 64px (h-16) |
| Main bg | gray-50 |

### Testing Requirements

```typescript
describe('Protected Routes', () => {
  it('should redirect to login when not authenticated', async () => {
    // Mock unauthenticated state
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    render(<AuthGuard><div>Protected Content</div></AuthGuard>);

    expect(mockLogin).toHaveBeenCalled();
  });

  it('should show content when authenticated', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { name: 'Test User' },
    });

    render(<AuthGuard><div>Protected Content</div></AuthGuard>);

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should show loading state while checking auth', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    render(<AuthGuard><div>Protected Content</div></AuthGuard>);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.10]
- [Source: _bmad-output/planning-artifacts/ux-sitemap-specification.md]
- [Next.js App Router: https://nextjs.org/docs/app]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/web/components/auth/auth-guard.tsx`
- `apps/web/components/layout/dashboard-shell.tsx`
- `apps/web/components/layout/sidebar.tsx`
- `apps/web/components/layout/header.tsx`
- `apps/web/app/(protected)/layout.tsx`
- `apps/web/app/(protected)/dashboard/page.tsx`
- `apps/web/app/(protected)/dashboard/agents/page.tsx`
- `apps/web/app/(protected)/dashboard/theme/page.tsx`
- `apps/web/app/(protected)/dashboard/analytics/page.tsx`
- `apps/web/app/(protected)/dashboard/team/page.tsx`
- `apps/web/app/(protected)/dashboard/settings/page.tsx`
- `apps/web/app/login/page.tsx`

Files to modify:
- `apps/web/app/page.tsx` (redirect logic)
