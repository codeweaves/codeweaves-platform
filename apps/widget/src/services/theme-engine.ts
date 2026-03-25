/**
 * Theme Engine — maps WidgetTheme API config to --cw-* CSS custom properties.
 *
 * Responsibilities:
 *  1. Flatten nested WidgetTheme → CSS variables using THEME_MAP
 *  2. Validate values before injection (color, size, font, string)
 *  3. Set variables on the shadow host element via style.setProperty
 *  4. Listen for postMessage theme updates in preview mode
 */

import { THEME_MAP, type ThemeValueType } from '../styles/theme-map';
import { debug, warn } from '../utils/debug';

// ── Value Validation ─────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// CSS Color Level 4: supports both comma-separated rgb(1,2,3) and space-separated rgb(1 2 3) with optional alpha
const RGB_RE = /^rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/;
const HSL_RE = /^hsla?\(\s*\d{1,3}[\s,]+\d{1,3}%[\s,]+\d{1,3}%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/;
const SIZE_RE = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/;
const SPECIAL_COLORS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset']);
/** Reject CSS injection patterns in string/font values */
const SUSPICIOUS_RE = /expression\s*\(|url\s*\(/i;

/**
 * Validate a CSS color value.
 * Accepts: hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla() (both
 * comma-separated and CSS Color Level 4 space-separated syntax),
 * named CSS colors (via CSS.supports), and special values.
 */
export function isValidColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (SPECIAL_COLORS.has(trimmed.toLowerCase())) return true;
  if (HEX_RE.test(trimmed)) return true;
  if (RGB_RE.test(trimmed)) return true;
  if (HSL_RE.test(trimmed)) return true;
  // Fallback: use CSS.supports for named colors and other valid syntaxes
  if (typeof CSS !== 'undefined' && CSS.supports) {
    return CSS.supports('color', trimmed);
  }
  return false;
}

/** Validate a CSS size/dimension value (px, rem, em, %, vh, vw). */
export function isValidSize(value: string): boolean {
  return SIZE_RE.test(value.trim());
}

/** Validate a font-family string. Rejects empty and injection patterns. */
export function isValidFontFamily(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Reject values with CSS-breaking or injection characters
  if (/[{};:]/.test(trimmed)) return false;
  if (SUSPICIOUS_RE.test(trimmed)) return false;
  return true;
}

/**
 * Strictly parse a numeric value — rejects trailing garbage, Infinity, NaN.
 * Returns the parsed number or null if invalid.
 */
function strictParseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Reject if not purely numeric (with optional decimal)
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    const num = Number(trimmed);
    if (!isFinite(num)) return null;
    return num;
  }
  return null;
}

/**
 * Validate a value based on its ThemeValueType.
 * Returns the validated CSS string, or null if invalid.
 */
function validateValue(
  value: unknown,
  type: ThemeValueType,
  field: string,
): string | null {
  if (value == null) return null;

  // Numeric types: convert number → CSS string with bounds checking
  if (type === 'number-px' || type === 'number-pct' || type === 'number-ms') {
    const num = strictParseNumber(value);
    if (num === null) {
      debug(`[CodeWeaves] Invalid theme value for ${field}: ${String(value)}, using default`);
      return null;
    }
    // Reject negative values for size/timing properties (never valid for widget dimensions)
    if (num < 0) {
      debug(`[CodeWeaves] Negative value rejected for ${field}: ${num}, using default`);
      return null;
    }
    const unit = type === 'number-px' ? 'px' : type === 'number-pct' ? '%' : 'ms';
    return `${num}${unit}`;
  }

  // String-based types
  const str = String(value).trim();
  if (!str) return null;

  switch (type) {
    case 'color':
      if (!isValidColor(str)) {
        debug(`[CodeWeaves] Invalid theme value for ${field}: ${str}, using default`);
        return null;
      }
      return str;

    case 'size':
      if (!isValidSize(str)) {
        debug(`[CodeWeaves] Invalid theme value for ${field}: ${str}, using default`);
        return null;
      }
      return str;

    case 'font':
      if (!isValidFontFamily(str)) {
        debug(`[CodeWeaves] Invalid theme value for ${field}: ${str}, using default`);
        return null;
      }
      return str;

    case 'string':
      // Defense-in-depth: reject suspicious CSS patterns
      if (SUSPICIOUS_RE.test(str) || /[{}<>]/.test(str)) {
        debug(`[CodeWeaves] Rejected suspicious string value for ${field}: ${str}, using default`);
        return null;
      }
      return str;

    default:
      return str;
  }
}

// ── Theme Application ────────────────────────────────────────────────

/**
 * Resolve a dot-notated key from a nested object.
 * E.g. resolveNested({ icon: { backgroundColor: '#f00' } }, 'icon.backgroundColor') → '#f00'
 */
function resolveNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Apply theme configuration to the host element as CSS custom properties.
 *
 * Iterates the THEME_MAP, resolves each field from the nested themeConfig,
 * validates, and sets valid values via style.setProperty on the host element.
 * Invalid or missing values are skipped — the CSS fallback defaults handle them.
 */
export function applyTheme(
  hostElement: HTMLElement,
  themeConfig: Record<string, unknown>,
): void {
  if (!hostElement || !themeConfig) return;

  let applied = 0;
  let skipped = 0;

  for (const [path, entry] of Object.entries(THEME_MAP)) {
    const rawValue = resolveNested(themeConfig, path);
    if (rawValue === undefined) {
      skipped++;
      continue;
    }

    const cssValue = validateValue(rawValue, entry.type, path);
    if (cssValue !== null) {
      hostElement.style.setProperty(entry.variable, cssValue);
      applied++;
    } else {
      // Remove any previously set value so the CSS default takes over
      hostElement.style.removeProperty(entry.variable);
      skipped++;
    }
  }

  debug(`Theme applied: ${applied} properties set, ${skipped} skipped/default`);
}

/**
 * Remove all theme CSS variables from the host element.
 * Used when resetting to defaults.
 */
export function clearTheme(hostElement: HTMLElement): void {
  for (const entry of Object.values(THEME_MAP)) {
    hostElement.style.removeProperty(entry.variable);
  }
  debug('Theme cleared — using stylesheet defaults');
}

// ── Preview Mode (postMessage) ───────────────────────────────────────

const THEME_UPDATE_TYPE = 'cw-theme-update';
const WIDGET_READY_TYPE = 'cw-widget-ready';

let previewListener: ((event: MessageEvent) => void) | null = null;

/**
 * Setup postMessage listener for live theme preview from the dashboard.
 *
 * @param hostElement - The shadow host element to apply theme variables to
 * @param allowedDomains - List of allowed origin domains (from agent config)
 */
export function setupPreviewMode(
  hostElement: HTMLElement,
  allowedDomains: string[],
): void {
  // Tear down any existing listener before setting up a new one (prevents leak)
  teardownPreviewMode();

  // Only activate if data-preview="true" on the script tag
  const script = document.querySelector('script[data-agent-id]');
  const isPreview = script?.getAttribute('data-preview') === 'true';
  if (!isPreview) return;

  // Build set of allowed origins for fast lookup
  const allowedOrigins = new Set<string>();
  // Always allow same origin
  allowedOrigins.add(window.location.origin);
  // Add configured domains
  for (const domain of allowedDomains) {
    const trimmed = domain.trim();
    if (!trimmed) continue;
    // If it's already a full origin (with protocol), use as-is
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      allowedOrigins.add(trimmed.replace(/\/$/, ''));
    } else {
      // Otherwise, add both http and https variants
      allowedOrigins.add(`https://${trimmed}`);
      allowedOrigins.add(`http://${trimmed}`);
    }
  }

  previewListener = (event: MessageEvent) => {
    // Validate origin
    if (!allowedOrigins.has(event.origin)) {
      warn(`Rejected theme update from unauthorized origin: ${event.origin}`);
      return;
    }

    // Validate message shape
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== THEME_UPDATE_TYPE) return;

    const theme = data.theme;
    if (!theme || typeof theme !== 'object') {
      debug('Received cw-theme-update with invalid theme payload');
      return;
    }

    debug('Preview: applying theme update from', event.origin);
    applyTheme(hostElement, theme as Record<string, unknown>);
  };

  window.addEventListener('message', previewListener);

  // Emit readiness handshake to each allowed origin (no wildcard)
  if (window.parent !== window) {
    for (const origin of allowedOrigins) {
      window.parent.postMessage({ type: WIDGET_READY_TYPE }, origin);
    }
  }

  debug('Preview mode active — listening for theme updates');
}

/** Remove the preview mode postMessage listener. */
export function teardownPreviewMode(): void {
  if (previewListener) {
    window.removeEventListener('message', previewListener);
    previewListener = null;
    debug('Preview mode listener removed');
  }
}
