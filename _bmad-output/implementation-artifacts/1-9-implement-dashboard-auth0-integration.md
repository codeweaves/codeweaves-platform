# Story 1.9: Implement Dashboard Auth0 Integration

Status: done

> **Note:** Stories 1.3 (AuthGuard for Protected Routes) and 1.4 (User Model and Database Schema) were also implemented and committed in the same branch (`feature/1-9-dashboard-auth0`) as this story.

## Story

As a **dashboard developer**,
I want Auth0 React SDK integrated,
So that users can log in and out from the dashboard.

## Acceptance Criteria

1. **Given** the Next.js dashboard exists
   **When** integrating Auth0
   **Then** `@auth0/auth0-react` is configured

2. **And** Login button redirects to Auth0

3. **And** Logout clears session and redirects

4. **And** Access token is available for API calls

5. **And** Token refresh happens automatically

## Tasks / Subtasks

- [x] Task 1: Install Auth0 React SDK (AC: 1)
  - [x] Install `@auth0/auth0-react`
  - [x] Add Auth0 types if needed

- [x] Task 2: Create Auth0 Provider wrapper (AC: 1)
  - [x] Create `providers/auth0-provider.tsx`
  - [x] Configure with environment variables
  - [x] Set up redirect URIs
  - [x] Configure audience for API access

- [x] Task 3: Add provider to app layout (AC: 1)
  - [x] Wrap app in Auth0Provider
  - [x] Ensure client-side only rendering

- [x] Task 4: Create authentication hooks/utilities (AC: 2, 3, 4)
  - [x] Create `useAuth` custom hook
  - [x] Create `useApiClient` hook with token injection
  - [x] Create login/logout utility functions

- [x] Task 5: Create login/logout components (AC: 2, 3)
  - [x] Create LoginButton component
  - [x] Create LogoutButton component
  - [x] Create UserProfile dropdown component

- [x] Task 6: Configure token management (AC: 4, 5)
  - [x] Set up getAccessTokenSilently
  - [x] Configure token caching
  - [x] Handle token refresh errors

- [x] Task 7: Test authentication flow
  - [x] Test login redirects to Auth0
  - [x] Test successful login returns to app
  - [x] Test logout clears session
  - [x] Test API calls include token

## Dev Notes

### Auth0 Provider Setup

```typescript
// apps/web/providers/auth0-provider.tsx
'use client';

import { Auth0Provider } from '@auth0/auth0-react';
import { useRouter } from 'next/navigation';
import { ReactNode } from 'react';

interface Auth0ProviderWrapperProps {
  children: ReactNode;
}

export function Auth0ProviderWrapper({ children }: Auth0ProviderWrapperProps) {
  const router = useRouter();

  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID!;
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE!;
  const redirectUri = typeof window !== 'undefined'
    ? `${window.location.origin}/callback`
    : process.env.NEXT_PUBLIC_AUTH0_REDIRECT_URI!;

  const onRedirectCallback = (appState: any) => {
    router.push(appState?.returnTo || '/dashboard');
  };

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience: audience,
        scope: 'openid profile email',
      }}
      onRedirectCallback={onRedirectCallback}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      useRefreshTokensFallback={true}
    >
      {children}
    </Auth0Provider>
  );
}
```

### Root Layout Integration

```typescript
// apps/web/app/layout.tsx
import { Auth0ProviderWrapper } from '@/providers/auth0-provider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Auth0ProviderWrapper>
          {children}
        </Auth0ProviderWrapper>
      </body>
    </html>
  );
}
```

### Custom useAuth Hook

```typescript
// apps/web/hooks/use-auth.ts
'use client';

import { useAuth0 } from '@auth0/auth0-react';
import { useCallback } from 'react';

export function useAuth() {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
    error,
  } = useAuth0();

  const login = useCallback((returnTo?: string) => {
    loginWithRedirect({
      appState: { returnTo: returnTo || '/dashboard' },
    });
  }, [loginWithRedirect]);

  const signOut = useCallback(() => {
    logout({
      logoutParams: {
        returnTo: window.location.origin,
      },
    });
  }, [logout]);

  const getToken = useCallback(async () => {
    try {
      return await getAccessTokenSilently();
    } catch (error) {
      console.error('Failed to get access token:', error);
      // If token refresh fails, redirect to login
      login();
      return null;
    }
  }, [getAccessTokenSilently, login]);

  return {
    isAuthenticated,
    isLoading,
    user,
    login,
    logout: signOut,
    getToken,
    error,
  };
}
```

### API Client with Token Injection

```typescript
// apps/web/lib/api-client.ts
'use client';

import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useMemo } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useApiClient() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();

  const fetchWithAuth = useCallback(async (
    endpoint: string,
    options: RequestInit = {}
  ) => {
    if (!isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const token = await getAccessTokenSilently();

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }

    return response.json();
  }, [getAccessTokenSilently, isAuthenticated]);

  return useMemo(() => ({
    get: (endpoint: string) => fetchWithAuth(endpoint, { method: 'GET' }),
    post: (endpoint: string, data: any) => fetchWithAuth(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    patch: (endpoint: string, data: any) => fetchWithAuth(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
  }), [fetchWithAuth]);
}
```

### Login Button Component

```typescript
// apps/web/components/auth/login-button.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function LoginButton() {
  const { login, isLoading } = useAuth();

  return (
    <Button
      onClick={() => login()}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Log In'}
    </Button>
  );
}
```

### Logout Button Component

```typescript
// apps/web/components/auth/logout-button.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const { logout, isLoading } = useAuth();

  return (
    <Button
      variant="ghost"
      onClick={logout}
      disabled={isLoading}
    >
      Log Out
    </Button>
  );
}
```

### User Profile Dropdown

```typescript
// apps/web/components/auth/user-menu.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function UserMenu() {
  const { user, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return null;
  }

  const initials = user.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.picture} alt={user.name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden md:block">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{user.name}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.location.href = '/settings/profile'}>
          Profile Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Environment Variables

```env
# apps/web/.env.local
NEXT_PUBLIC_AUTH0_DOMAIN=your-tenant.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.codeweaves.com
NEXT_PUBLIC_AUTH0_REDIRECT_URI=http://localhost:3000/callback
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Architecture Compliance

- **ADR-005:** Auth0 for Authentication
- **ADR-010:** Zustand + TanStack Query for State Management
- **NFR12:** All user authentication must be handled via Auth0

### Token Caching Strategy

| Setting | Value | Purpose |
|---------|-------|---------|
| cacheLocation | localstorage | Persist tokens across page reloads |
| useRefreshTokens | true | Enable automatic token refresh |
| useRefreshTokensFallback | true | Fallback for older browsers |

### Testing Requirements

```typescript
describe('Auth0 Integration', () => {
  it('should redirect to Auth0 on login click', async () => {
    render(<LoginButton />);

    const loginButton = screen.getByText('Log In');
    fireEvent.click(loginButton);

    // Verify redirect to Auth0 (mock useAuth0)
    expect(mockLoginWithRedirect).toHaveBeenCalled();
  });

  it('should clear session on logout', async () => {
    render(<LogoutButton />);

    const logoutButton = screen.getByText('Log Out');
    fireEvent.click(logoutButton);

    expect(mockLogout).toHaveBeenCalledWith({
      logoutParams: { returnTo: expect.any(String) },
    });
  });

  it('should include token in API requests', async () => {
    const { result } = renderHook(() => useApiClient());

    await act(async () => {
      await result.current.get('/api/users/me');
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      }),
    );
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.9]
- [Auth0 React SDK: https://auth0.com/docs/libraries/auth0-react]
- [Next.js with Auth0: https://auth0.com/docs/quickstart/webapp/nextjs]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/web/providers/auth0-provider.tsx`
- `apps/web/hooks/use-auth.ts`
- `apps/web/lib/api-client.ts`
- `apps/web/components/auth/login-button.tsx`
- `apps/web/components/auth/logout-button.tsx`
- `apps/web/components/auth/user-menu.tsx`

Files to modify:
- `apps/web/app/layout.tsx` (add Auth0Provider)
- `apps/web/package.json` (add @auth0/auth0-react)
- `apps/web/.env.example` (add Auth0 vars)
