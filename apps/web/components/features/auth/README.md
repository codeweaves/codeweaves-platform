# Auth0 Integration Components

This directory contains Auth0 React SDK integration components for the CodeWeaves dashboard.

## Components

### LoginButton
A button component that triggers Auth0 login flow.

```tsx
import { LoginButton } from '@/components/features/auth/login-button';

export default function Page() {
  return <LoginButton />;
}
```

### LogoutButton
A button component that logs out the user and clears the session.

```tsx
import { LogoutButton } from '@/components/features/auth/logout-button';

export default function Page() {
  return <LogoutButton />;
}
```

### UserMenu
A dropdown menu component that displays user information and provides logout functionality.

```tsx
import { UserMenu } from '@/components/features/auth/user-menu';

export default function Header() {
  return (
    <header>
      <UserMenu />
    </header>
  );
}
```

## Hooks

### useAuth
Custom hook that provides authentication state and methods.

```tsx
import { useAuth } from '@/hooks/use-auth';

export default function Page() {
  const { isAuthenticated, isLoading, user, login, logout, getToken } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!isAuthenticated) return <button onClick={() => login()}>Login</button>;

  return <div>Welcome {user?.name}</div>;
}
```

### useApiClient
Hook that provides authenticated API client methods.

```tsx
import { useApiClient } from '@/lib/api-client';

export default function Page() {
  const api = useApiClient();

  const fetchData = async () => {
    const data = await api.get('/api/users/me');
    console.log(data);
  };

  return <button onClick={fetchData}>Fetch Data</button>;
}
```

## Environment Variables

Required environment variables in `.env.local`:

```env
NEXT_PUBLIC_AUTH0_DOMAIN=codeweaves.jp.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-spa-client-id
NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.codeweaves.com
NEXT_PUBLIC_AUTH0_REDIRECT_URI=http://localhost:3000/callback
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Features

- Auth0 login/logout integration
- Automatic token refresh
- Token caching in localStorage
- API client with automatic token injection
- Type-safe hooks and components
- Error handling for token refresh failures
