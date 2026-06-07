'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useMemo } from 'react';
import { apiUrl } from '@/config/api';

// Must match the Clerk JWT template the NestJS API verifies.
const CLERK_JWT_TEMPLATE = 'klivo-api';

export function useApiClient() {
  const { getToken, isSignedIn } = useAuth();

  const fetchWithAuth = useCallback(async (
    endpoint: string,
    options: RequestInit = {},
    skipContentType = false,
  ) => {
    if (!isSignedIn) {
      throw new Error('Not authenticated');
    }

    const token = await getToken({ template: CLERK_JWT_TEMPLATE });
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };
    if (!skipContentType) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(apiUrl(endpoint), {
      ...options,
      headers,
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
  }, [getToken, isSignedIn]);

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
    upload: (endpoint: string, file: File, fields?: Record<string, string>) => {
      const formData = new FormData();
      formData.append('file', file);
      if (fields) {
        for (const [key, value] of Object.entries(fields)) {
          formData.append(key, value);
        }
      }
      return fetchWithAuth(endpoint, { method: 'POST', body: formData }, true);
    },
  }), [fetchWithAuth]);
}
