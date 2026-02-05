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
    post: (endpoint: string, data: unknown) => fetchWithAuth(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    patch: (endpoint: string, data: unknown) => fetchWithAuth(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
  }), [fetchWithAuth]);
}
