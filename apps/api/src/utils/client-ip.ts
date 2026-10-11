/**
 * The client IP exactly as Express derives it from the proxy chain (`trust proxy`,
 * set from TRUST_PROXY_HOPS in main.ts). Never the raw `x-forwarded-for` header:
 * a client can rotate it per request to mint fresh rate-limit buckets or forge its
 * visitor identity. Callers choose their own fallback when this is undefined.
 */
export function clientIp(request: { ip?: string }): string | undefined {
  return request.ip || undefined;
}

/**
 * Express `trust proxy` hop count from TRUST_PROXY_HOPS. Too low and request.ip is
 * a shared proxy address, so unrelated visitors share one rate-limit bucket. Too
 * high and, if the origin is reachable without the CDN, a client can forge its IP
 * through X-Forwarded-For. Only a plain non-negative integer is accepted; anything
 * else falls back to 1.
 */
export function trustProxyHops(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  return /^\d+$/.test(value) ? Number(value) : 1;
}
