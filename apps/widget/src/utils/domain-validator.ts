/**
 * Domain validation utility for CORS domain allowlist checking (Story 5-12).
 *
 * Client-side convenience check — the real security boundary is the backend
 * CORS middleware that validates the Origin header per-agent.
 */

/** Hostnames that are always allowed regardless of allowedDomains config */
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/**
 * Check whether the current hostname is permitted by the agent's allowed domains list.
 *
 * @param hostname - The current `window.location.hostname`
 * @param allowedDomains - The agent's configured allowed domains (may include wildcards like `*.example.com`)
 * @returns `true` if the domain is allowed, `false` otherwise
 *
 * Rules:
 * - Empty `allowedDomains` → allow all (no restrictions configured)
 * - Dev hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`) → always allowed
 * - Exact match: `example.com` matches only `example.com`
 * - Wildcard: `*.example.com` matches `sub.example.com` and `deep.sub.example.com`
 * - Matching is case-insensitive
 */
export function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  // No restrictions configured — allow all
  if (allowedDomains.length === 0) return true;

  const host = hostname.toLowerCase().trim();

  // Dev hosts are always allowed
  if (DEV_HOSTS.has(host)) return true;

  for (const pattern of allowedDomains) {
    if (typeof pattern !== 'string') continue;
    const p = pattern.toLowerCase().trim();
    if (!p) continue;

    if (p.startsWith('*.')) {
      // Wildcard pattern: *.example.com
      // Matches sub.example.com, deep.sub.example.com, etc.
      const base = p.slice(2); // "example.com"

      // Also allow the bare domain (e.g., *.example.com matches example.com)
      if (host === base) return true;

      if (host.endsWith('.' + base)) return true;
    } else {
      // Exact match
      if (host === p) return true;
    }
  }

  return false;
}
