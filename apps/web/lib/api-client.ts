'use client';

import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useMemo } from 'react';
import { apiUrl } from '@/config/api';

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

    const response = await fetch(apiUrl(endpoint), {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }

    return null;
  }, [getAccessTokenSilently, isAuthenticated]);

  return useMemo(() => ({
    get: (endpoint: string) => fetchWithAuth(endpoint, { method: 'GET' }),
    post: (endpoint: string, data?: unknown) => fetchWithAuth(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
    put: (endpoint: string, data: unknown) => fetchWithAuth(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    patch: (endpoint: string, data: unknown) => fetchWithAuth(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
  }), [fetchWithAuth]);
}
