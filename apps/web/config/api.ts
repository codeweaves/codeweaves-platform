export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const API_PREFIX = '/api/codeweaves/v1';

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${API_PREFIX}${path}`;
}
