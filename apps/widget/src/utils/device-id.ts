/**
 * Device ID generation and persistence (Story 5-16).
 *
 * Provides a stable device identifier for rate limiting and session scoping.
 * Storage fallback chain: localStorage → cookie → in-memory.
 * UUID generation: native crypto APIs only (no external libraries).
 */

const STORAGE_KEY = 'cw_device_id';
const COOKIE_MAX_AGE = 31536000; // 1 year in seconds
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Module-level cache — ensures consistency within a page session (AC 3).
let cachedDeviceId: string | null = null;

// ── UUID Generation (Task 1, AC 4) ─────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    // No Web Crypto at all — fallback to Math.random (very rare: old WebViews on HTTP)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Fallback: crypto.getRandomValues() with manual UUID v4 formatting
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10).join('')
  );
}

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

// ── Storage helpers (Task 2, AC 1, 2) ──────────────────────────────

function readLocalStorage(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && isValidUUID(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(id: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    console.warn('[CodeWeaves] localStorage unavailable, using fallback');
    return false;
  }
}

function readCookie(): string | null {
  try {
    const match = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${STORAGE_KEY}=`));
    if (!match) return null;
    const value = match.substring(STORAGE_KEY.length + 1);
    return isValidUUID(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCookie(id: string): boolean {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${STORAGE_KEY}=${id}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
    // Verify the write succeeded (cookies silently fail in cross-origin iframes)
    return readCookie() === id;
  } catch {
    return false;
  }
}

function persist(id: string): void {
  if (writeLocalStorage(id)) return;
  if (writeCookie(id)) return;
  console.warn('[CodeWeaves] All persistent storage unavailable, device ID is session-only');
}

// ── Public API (Task 3, AC 1, 2, 3) ────────────────────────────────

/**
 * Returns a stable device ID, generating and persisting one if needed.
 *
 * Lookup order: module cache → localStorage → cookie → generate new.
 * The returned value is cached for the lifetime of the page.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  // Check persisted stores
  const fromStorage = readLocalStorage();
  if (fromStorage) {
    cachedDeviceId = fromStorage;
    return cachedDeviceId;
  }

  const fromCookie = readCookie();
  if (fromCookie) {
    cachedDeviceId = fromCookie;
    // Promote cookie value to localStorage if possible
    writeLocalStorage(cachedDeviceId);
    return cachedDeviceId;
  }

  // Generate new ID and persist
  cachedDeviceId = generateUUID();
  persist(cachedDeviceId);
  return cachedDeviceId;
}

/**
 * Clears the cached device ID and removes it from all storage.
 * Useful for logout or GDPR data clearing flows.
 */
export function resetDeviceId(): void {
  cachedDeviceId = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — storage may be unavailable
  }
  try {
    document.cookie = `${STORAGE_KEY}=; max-age=0; path=/; SameSite=Lax`;
  } catch {
    // Ignore — cookies may be unavailable
  }
}
