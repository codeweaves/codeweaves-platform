/**
 * Debug logging utility for CodeWeaves widget.
 *
 * Logs are emitted when:
 * - Vite dev mode (`import.meta.env.DEV`) is active, OR
 * - The `data-debug` attribute is present on the script tag
 *
 * All messages are prefixed with [CodeWeaves].
 */

const PREFIX = '[CodeWeaves]';

let debugEnabled = false;

/** Enable debug logging (called during script tag init). */
export function enableDebug(): void {
  debugEnabled = true;
}

/** Check whether debug logging is active. */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/** Log a debug message (suppressed in production unless `data-debug` is set). */
export function debug(...args: unknown[]): void {
  if (!debugEnabled) return;
  // Uses console.debug so terser pure_funcs strips these calls in production
  console.debug(PREFIX, ...args);
}

/** Always-visible warning (never suppressed). */
export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}
