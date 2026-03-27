/**
 * Fetch utilities for the widget API client (Story 5-15, Tasks 5 & 6).
 *
 * - fetchWithTimeout: AbortController-based timeout wrapper around native fetch.
 * - fetchWithRetry: Single-retry with exponential backoff for 5xx / network errors.
 */

import { WidgetApiError, networkError, timeoutError } from './api-errors';

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;

/**
 * Wraps native fetch with an AbortController timeout.
 * Clears the timer on completion to prevent leaking timers.
 *
 * If the caller passes a `signal` in options, both the caller's signal and
 * the internal timeout can abort the request (whichever fires first).
 */
export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller provided an external signal, forward its abort to our controller
  const externalSignal = options.signal;
  let onExternalAbort: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }
    onExternalAbort = () => controller.abort();
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  function cleanup(): void {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  return fetch(url, { ...options, signal: controller.signal }).then(
    (response) => {
      cleanup();
      return response;
    },
    (error: unknown) => {
      cleanup();
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Distinguish between caller abort and timeout abort
        if (externalSignal?.aborted) {
          throw error; // Re-throw as DOMException — caller cancelled
        }
        throw timeoutError();
      }
      throw networkError(error);
    },
  );
}

/**
 * Wraps a fetch call with a single retry on 5xx or network error.
 * Does NOT retry on 4xx (client errors) or timeout (already waited).
 * Set `retry: false` to disable retry (e.g. for non-idempotent streaming requests).
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  retry: boolean = true,
): Promise<Response> {
  try {
    const response = await fetchWithTimeout(url, options, timeoutMs);
    if (retry && response.status >= 500) {
      await delay(RETRY_DELAY_MS);
      return fetchWithTimeout(url, options, timeoutMs);
    }
    return response;
  } catch (error: unknown) {
    // Don't retry on timeout or non-retryable errors
    if (!retry || (error instanceof WidgetApiError && !error.retryable)) {
      throw error;
    }
    // Retry once on network error
    await delay(RETRY_DELAY_MS);
    return fetchWithTimeout(url, options, timeoutMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
