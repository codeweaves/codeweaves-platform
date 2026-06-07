'use client';

import { useAuth as useClerkAuth, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

// JWT template configured in the Clerk dashboard. Its tokens carry the `email`
// claim and the `klivo-api` audience the NestJS API verifies.
const CLERK_JWT_TEMPLATE = 'klivo-api';

/**
 * App-wide auth hook. Intentionally exposes the same surface the app relied on
 * under Auth0 (`isAuthenticated`, `isLoading`, `user`, `login`, `logout`,
 * `getToken`, `error`) so consuming components need (almost) no changes.
 * The `user` object is normalized to a small, stable shape.
 */
export function useAuth() {
  const {
    isLoaded,
    isSignedIn,
    getToken: clerkGetToken,
    signOut: clerkSignOut,
  } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const router = useRouter();

  const login = useCallback(
    (returnTo?: string) => {
      const target = returnTo || '/dashboard';
      router.push(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
    },
    [router],
  );

  const logout = useCallback(() => {
    void clerkSignOut({ redirectUrl: '/' });
  }, [clerkSignOut]);

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await clerkGetToken({ template: CLERK_JWT_TEMPLATE });
      if (!token) {
        login();
        return null;
      }
      return token;
    } catch (error) {
      console.error('Failed to get access token:', error);
      login();
      return null;
    }
  }, [clerkGetToken, login]);

  const user = clerkUser
    ? {
        id: clerkUser.id,
        sub: clerkUser.id, // back-compat alias for former Auth0 `sub`
        email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
        name: clerkUser.fullName,
        imageUrl: clerkUser.imageUrl,
      }
    : undefined;

  return {
    isAuthenticated: Boolean(isSignedIn),
    isLoading: !isLoaded,
    user,
    login,
    logout,
    getToken,
    error: undefined,
  };
}
