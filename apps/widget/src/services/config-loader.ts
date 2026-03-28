/**
 * Config-loader service for CodeWeaves widget (Story 5-4).
 *
 * Implements cache-first fetch strategy with ETag-based revalidation:
 *   1. If localStorage cache is valid (< TTL), return immediately.
 *   2. Otherwise fetch from API with If-None-Match header.
 *   3. 200 → store new config + ETag; 304 → refresh TTL; error → fallback to cache.
 */

import type { LoadedWidgetConfig } from '../types';
import { debug, warn } from '../utils/debug';

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = import.meta.env.DEV ? 0 : 300_000; // 0 in dev, 5 minutes in production
const FETCH_TIMEOUT_MS = 5_000;

const KEY_CONFIG = (id: string) => `cw_config_${id}`;
const KEY_ETAG = (id: string) => `cw_etag_${id}`;
const KEY_TS = (id: string) => `cw_ts_${id}`;

// ── In-memory fallback keyed by agentId (for private browsing / quota exceeded)

interface MemoryEntry {
  config: LoadedWidgetConfig;
  etag: string | null;
  ts: number;
}

const memoryCache = new Map<string, MemoryEntry>();

// ── localStorage cache layer (Task 2) ───────────────────────────────

function isCacheValid(agentId: string, ttl: number = DEFAULT_TTL_MS): boolean {
  const ts = readTs(agentId);
  if (ts === null) return false;
  return Date.now() - ts < ttl;
}

function getCachedConfig(agentId: string): LoadedWidgetConfig | null {
  try {
    const raw = localStorage.getItem(KEY_CONFIG(agentId));
    if (!raw) return memoryCache.get(agentId)?.config ?? null;
    return JSON.parse(raw) as LoadedWidgetConfig;
  } catch {
    return memoryCache.get(agentId)?.config ?? null;
  }
}

function getCachedEtag(agentId: string): string | null {
  try {
    return localStorage.getItem(KEY_ETAG(agentId)) ?? memoryCache.get(agentId)?.etag ?? null;
  } catch {
    return memoryCache.get(agentId)?.etag ?? null;
  }
}

function setCachedConfig(
  agentId: string,
  config: LoadedWidgetConfig,
  etag: string | null,
): void {
  const ts = Date.now();

  // Always update in-memory fallback (keyed by agentId)
  memoryCache.set(agentId, { config, etag, ts });

  try {
    localStorage.setItem(KEY_CONFIG(agentId), JSON.stringify(config));
    if (etag) localStorage.setItem(KEY_ETAG(agentId), etag);
    localStorage.setItem(KEY_TS(agentId), String(ts));
  } catch {
    warn('localStorage write failed — using in-memory cache for this session');
  }
}

function refreshCacheTimestamp(agentId: string): void {
  const ts = Date.now();
  const entry = memoryCache.get(agentId);
  if (entry) entry.ts = ts;
  try {
    localStorage.setItem(KEY_TS(agentId), String(ts));
  } catch {
    // Silently degrade
  }
}

function readTs(agentId: string): number | null {
  try {
    const raw = localStorage.getItem(KEY_TS(agentId));
    if (raw) return Number(raw);
  } catch {
    // localStorage unavailable
  }
  return memoryCache.get(agentId)?.ts ?? null;
}

// ── Fetch with AbortController timeout (Task 5) ─────────────────────

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

// ── Main entry point (Tasks 1, 3, 4, 5) ─────────────────────────────

export async function loadConfig(
  agentId: string,
  apiBaseUrl: string,
  ttl: number = DEFAULT_TTL_MS,
): Promise<LoadedWidgetConfig | null> {
  // Task 3: Cache-first — if valid cache exists, return immediately
  if (isCacheValid(agentId, ttl)) {
    const cached = getCachedConfig(agentId);
    if (cached) {
      debug('Config cache hit (TTL valid)');
      return cached;
    }
  }

  // Build fetch URL (strip trailing slash from apiBaseUrl)
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = `${base}/api/codeweaves/v1/public/agents/${encodeURIComponent(agentId)}/config`;

  // Task 3: Include If-None-Match header when ETag is cached
  const headers: Record<string, string> = {};
  const cachedEtag = getCachedEtag(agentId);
  if (cachedEtag) {
    headers['If-None-Match'] = cachedEtag;
  }

  try {
    const response = await fetchWithTimeout(url, { headers });

    // Task 4: Handle API response codes
    if (response.status === 200) {
      const config = (await response.json()) as LoadedWidgetConfig;
      const etag = response.headers.get('etag');
      setCachedConfig(agentId, config, etag);
      debug('Config fetched (200), ETag:', etag);
      return config;
    }

    if (response.status === 304) {
      refreshCacheTimestamp(agentId);
      const cached = getCachedConfig(agentId);
      debug('Config not modified (304), using cache');
      return cached;
    }

    if (response.status === 404) {
      warn('Agent not found (404)');
      clearConfigCache(agentId);
      return null;
    }

    // 5xx or other 4xx — fall back to cache
    warn(`API returned ${response.status}, falling back to cache`);
    return getCachedConfig(agentId);
  } catch {
    // Task 5: Network error fallback
    const cached = getCachedConfig(agentId);
    if (cached) {
      warn('API unreachable, using cached config');
      return cached;
    }

    warn('API unreachable and no cached config available');
    return null;
  }
}

/**
 * Clear all cached config for an agent (useful for destroy/re-init).
 */
export function clearConfigCache(agentId: string): void {
  memoryCache.delete(agentId);
  try {
    localStorage.removeItem(KEY_CONFIG(agentId));
    localStorage.removeItem(KEY_ETAG(agentId));
    localStorage.removeItem(KEY_TS(agentId));
  } catch {
    // Silently degrade
  }
}
