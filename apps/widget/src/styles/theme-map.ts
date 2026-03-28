/**
 * Complete mapping from WidgetTheme API fields to CSS custom properties.
 *
 * The API returns a nested WidgetTheme object (e.g. { icon: { backgroundColor: '#3b82f6' } }).
 * This map flattens those nested paths to --cw-* CSS variable names with defaults and value types.
 *
 * Value types control validation:
 *  - 'color': hex, rgb(), rgba(), hsl(), hsla(), named CSS colors, transparent, currentColor
 *  - 'size':  px, rem, em, %, vh, vw values
 *  - 'font':  font-family strings
 *  - 'string': any CSS value (shadows, etc.) — no validation
 *  - 'number-px': numeric API value converted to px string (e.g. 56 → '56px')
 *  - 'number-pct': numeric API value converted to % string (e.g. 50 → '50%')
 *  - 'number-ms': numeric API value converted to ms string (e.g. 200 → '200ms')
 */

export type ThemeValueType =
  | 'color'
  | 'size'
  | 'font'
  | 'string'
  | 'number-px'
  | 'number-pct'
  | 'number-ms';

export interface ThemeMapEntry {
  /** CSS custom property name (e.g. '--cw-icon-bg') */
  variable: string;
  /** Default CSS value */
  default: string;
  /** Value type for validation */
  type: ThemeValueType;
}

/**
 * Flat mapping: "section.field" → ThemeMapEntry
 *
 * Keys use dot notation matching the WidgetTheme structure from the API.
 * E.g. "icon.backgroundColor" maps to the API shape { icon: { backgroundColor: '...' } }
 */
export const THEME_MAP: Record<string, ThemeMapEntry> = {
  // ── Icon / Launcher ─────────────────────────────────────────────────
  'icon.backgroundColor':      { variable: '--cw-icon-bg',             default: '#3b82f6', type: 'color' },
  'icon.hoverBackgroundColor': { variable: '--cw-icon-hover-bg',       default: '#2563eb', type: 'color' },
  'icon.size':                 { variable: '--cw-icon-size',           default: '56px',    type: 'number-px' },
  'icon.borderRadius':         { variable: '--cw-icon-radius',         default: '50%',     type: 'number-pct' },
  'icon.shadow':               { variable: '--cw-icon-shadow',         default: '0 4px 12px rgba(0, 0, 0, 0.15)', type: 'string' },

  // ── Header ──────────────────────────────────────────────────────────
  'header.backgroundColor':    { variable: '--cw-header-bg',           default: '#3b82f6', type: 'color' },
  'header.textColor':          { variable: '--cw-header-text',         default: '#ffffff', type: 'color' },
  'header.subtitleColor':      { variable: '--cw-header-subtitle',     default: '#e0e7ff', type: 'color' },
  'header.borderRadius':       { variable: '--cw-header-radius',       default: '14px',    type: 'number-px' },

  // ── User Message Bubbles ────────────────────────────────────────────
  'userMessage.backgroundColor': { variable: '--cw-msg-user-bg',       default: '#3b82f6', type: 'color' },
  'userMessage.textColor':       { variable: '--cw-msg-user-text',     default: '#ffffff', type: 'color' },
  'userMessage.borderRadius':    { variable: '--cw-msg-user-radius',   default: '14px',    type: 'number-px' },

  // ── Bot Message Bubbles ─────────────────────────────────────────────
  'botMessage.backgroundColor':  { variable: '--cw-msg-bot-bg',        default: '#f3f4f6', type: 'color' },
  'botMessage.textColor':        { variable: '--cw-msg-bot-text',      default: '#1f2937', type: 'color' },
  'botMessage.borderRadius':     { variable: '--cw-msg-bot-radius',    default: '14px',    type: 'number-px' },

  // ── Bot Avatar ──────────────────────────────────────────────────────
  'botAvatar.backgroundColor':   { variable: '--cw-avatar-bot-bg',     default: '#e0e7ff', type: 'color' },
  'botAvatar.color':             { variable: '--cw-avatar-bot-color',  default: '#3b82f6', type: 'color' },

  // ── User Avatar ─────────────────────────────────────────────────────
  'userAvatar.backgroundColor':  { variable: '--cw-avatar-user-bg',    default: '#dbeafe', type: 'color' },
  'userAvatar.color':            { variable: '--cw-avatar-user-color', default: '#3b82f6', type: 'color' },

  // ── Input Area ──────────────────────────────────────────────────────
  'input.backgroundColor':     { variable: '--cw-input-bg',            default: '#ffffff', type: 'color' },
  'input.textColor':           { variable: '--cw-input-text',          default: '#1f2937', type: 'color' },
  'input.placeholderColor':    { variable: '--cw-input-placeholder',   default: '#9ca3af', type: 'color' },
  'input.borderColor':         { variable: '--cw-input-border',        default: '#e5e7eb', type: 'color' },
  'input.borderRadius':        { variable: '--cw-input-radius',        default: '14px',    type: 'number-px' },

  // ── Send Button ─────────────────────────────────────────────────────
  'sendButton.backgroundColor':      { variable: '--cw-send-bg',       default: '#3b82f6', type: 'color' },
  'sendButton.hoverBackgroundColor': { variable: '--cw-send-hover-bg', default: '#2563eb', type: 'color' },
  'sendButton.iconColor':            { variable: '--cw-send-icon',     default: '#ffffff', type: 'color' },
  'sendButton.borderRadius':         { variable: '--cw-send-radius',   default: '14px',    type: 'number-px' },

  // ── Body / Chat Area ────────────────────────────────────────────────
  'body.backgroundColor':      { variable: '--cw-body-bg',             default: '#ffffff', type: 'color' },

  // ── Bubble Notification ─────────────────────────────────────────────
  'bubble.backgroundColor':    { variable: '--cw-bubble-bg',           default: '#ffffff', type: 'color' },
  'bubble.textColor':          { variable: '--cw-bubble-text',         default: '#1f2937', type: 'color' },

  // ── Typography ──────────────────────────────────────────────────────
  'typography.fontFamily':     { variable: '--cw-font-family',         default: 'Inter, system-ui, sans-serif', type: 'font' },
  'typography.baseFontSize':   { variable: '--cw-font-size',           default: '14px',    type: 'number-px' },

  // ── Animations ──────────────────────────────────────────────────────
  'animations.transitionDuration': { variable: '--cw-transition-duration', default: '200ms', type: 'number-ms' },

  // ── Timestamps ──────────────────────────────────────────────────────
  'timestamps.color':          { variable: '--cw-timestamp-color',     default: '#9ca3af', type: 'color' },

  // ── Branding ────────────────────────────────────────────────────────
  'branding.textColor':        { variable: '--cw-branding-text',       default: '#9ca3af', type: 'color' },
  'branding.linkColor':        { variable: '--cw-branding-link',       default: '#3b82f6', type: 'color' },
};

/** All CSS variable names for quick lookup */
export const ALL_CSS_VARIABLES = Object.values(THEME_MAP).map((e) => e.variable);
