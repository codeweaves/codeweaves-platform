export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetMs: number;
}

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/** 100 requests / 60s (authenticated API endpoints) */
export const DEFAULT_API_RATE_LIMIT: RateLimitConfig = {
  limit: 100,
  windowMs: 60_000,
};

/** 30 requests / 60s (unauthenticated/widget endpoints) */
export const DEFAULT_PUBLIC_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowMs: 60_000,
};

/** 10 messages / 60s per device */
export const DEFAULT_MESSAGE_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60_000,
};
