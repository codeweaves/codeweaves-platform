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
