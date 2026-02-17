/**
 * Domain normalization and validation utilities for agent allowedDomains.
 */

/**
 * Strip protocol, path, trailing slash, and lowercase the domain.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .replace(/\/$/, '');
}

// Matches: example.com, sub.example.com, example.com:3000
const HOSTNAME_RE =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d+)?$/;

// Matches: *.example.com, *.sub.example.com
const WILDCARD_RE =
  /^\*\.([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d+)?$/;

// Matches: localhost, localhost:3000
const LOCALHOST_RE = /^localhost(:\d+)?$/;

// Matches: 192.168.1.1, 10.0.0.1:8080
const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;

/**
 * Validate a normalized domain string.
 * Accepts hostnames, IPs, localhost, and single-level wildcard (*.example.com).
 */
export function isValidDomain(input: string): boolean {
  const normalized = normalizeDomain(input);
  if (!normalized) return false;
  return (
    HOSTNAME_RE.test(normalized) ||
    WILDCARD_RE.test(normalized) ||
    LOCALHOST_RE.test(normalized) ||
    IP_RE.test(normalized)
  );
}

/**
 * Normalize and deduplicate a list of domains.
 * Returns only valid, unique domains.
 */
export function deduplicateDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  return domains.reduce<string[]>((acc, d) => {
    const n = normalizeDomain(d);
    if (n && !seen.has(n)) {
      seen.add(n);
      acc.push(n);
    }
    return acc;
  }, []);
}
