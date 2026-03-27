/**
 * Widget API error types and error mapping (Story 5-15, Task 7).
 *
 * Provides a structured error class for all API interactions,
 * with user-friendly messages and retry metadata.
 */

export class WidgetApiError extends Error {
  readonly status: number;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(opts: {
    status: number;
    userMessage: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(opts.userMessage);
    this.name = 'WidgetApiError';
    this.status = opts.status;
    this.userMessage = opts.userMessage;
    this.retryable = opts.retryable;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    if (opts.cause) this.cause = opts.cause;
  }
}

/** Map an HTTP response to a WidgetApiError (for non-OK responses). */
export async function mapResponseError(response: Response): Promise<WidgetApiError> {
  const status = response.status;

  if (status === 404) {
    return new WidgetApiError({
      status,
      userMessage: 'Agent not found or inactive',
      retryable: false,
    });
  }

  if (status === 429) {
    let userMessage = 'Too many requests. Please wait a moment.';
    let retryAfterSeconds: number | undefined;
    try {
      const body = await response.json();
      if (body.message) userMessage = body.message;
      if (typeof body.retryAfterSeconds === 'number') retryAfterSeconds = body.retryAfterSeconds;
    } catch {
      // use defaults
    }
    return new WidgetApiError({
      status,
      userMessage,
      retryable: true,
      retryAfterSeconds,
    });
  }

  if (status >= 500) {
    return new WidgetApiError({
      status,
      userMessage: 'Something went wrong. Please try again.',
      retryable: true,
    });
  }

  // Other 4xx
  return new WidgetApiError({
    status,
    userMessage: 'Something went wrong. Please try again.',
    retryable: false,
  });
}

/** Create a WidgetApiError for a network failure. */
export function networkError(cause: unknown): WidgetApiError {
  return new WidgetApiError({
    status: 0,
    userMessage: 'Unable to connect. Please check your internet connection.',
    retryable: true,
    cause,
  });
}

/** Create a WidgetApiError for a request timeout. */
export function timeoutError(): WidgetApiError {
  return new WidgetApiError({
    status: 0,
    userMessage: 'Request timed out. Please try again.',
    retryable: false,
  });
}
