/**
 * Default theme CSS custom properties with --cw-* namespace.
 *
 * These defaults are declared on :host and serve as fallbacks.
 * Runtime values from the API (set via style.setProperty on host) take precedence.
 *
 * Generated from THEME_MAP defaults + additional layout/spacing variables.
 */
import { THEME_MAP } from './theme-map';

/** Build the :host block from THEME_MAP defaults + layout variables */
function buildThemeCSS(): string {
  const mapDefaults = Object.values(THEME_MAP)
    .map((entry) => `  ${entry.variable}: ${entry.default};`)
    .join('\n');

  return `:host {
${mapDefaults}

  /* Layout & Spacing (not theme-configurable, but used by components) */
  --cw-widget-width: 400px;
  --cw-widget-height: 600px;
  --cw-widget-bottom: 20px;
  --cw-widget-right: 20px;
  --cw-trigger-size: var(--cw-icon-size, 56px);
  --cw-trigger-bg: var(--cw-icon-bg, #3b82f6);
  --cw-trigger-fg: #ffffff;
  --cw-trigger-shadow: var(--cw-icon-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  --cw-header-fg: var(--cw-header-text, #ffffff);
  --cw-msg-user-fg: var(--cw-msg-user-text, #ffffff);
  --cw-msg-bot-fg: var(--cw-msg-bot-text, #1f2937);
  --cw-input-fg: var(--cw-input-text, #1f2937);
  --cw-bubble-fg: var(--cw-bubble-text, #1f2937);

  /* Derived surface colors */
  --cw-primary: var(--cw-icon-bg, #3b82f6);
  --cw-primary-hover: var(--cw-icon-hover-bg, #2563eb);
  --cw-primary-foreground: #ffffff;
  --cw-background: var(--cw-body-bg, #ffffff);
  --cw-foreground: var(--cw-msg-bot-text, #1f2937);
  --cw-muted: #f1f5f9;
  --cw-muted-foreground: #64748b;
  --cw-border: var(--cw-input-border, #e5e7eb);
  --cw-border-radius: 0.5rem;
  --cw-line-height: 1.5;

  /* Spacing */
  --cw-spacing-xs: 0.25rem;
  --cw-spacing-sm: 0.5rem;
  --cw-spacing-md: 1rem;
  --cw-spacing-lg: 1.5rem;
  --cw-spacing-xl: 2rem;

  /* Animation */
  --cw-transition-easing: cubic-bezier(0.4, 0, 0.2, 1);

  /* Z-index */
  --cw-z-index: 2147483000;

  /* Bubble notification */
  --cw-bubble-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);

  /* Message radius alias */
  --cw-msg-radius: var(--cw-msg-bot-radius, 16px);
}
`;
}

export const themeCSS = buildThemeCSS();
