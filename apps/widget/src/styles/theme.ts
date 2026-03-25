/** Default theme CSS custom properties with --cw-* namespace */
export const themeCSS = `
:host {
  /* Primary colors */
  --cw-primary: #6366f1;
  --cw-primary-hover: #4f46e5;
  --cw-primary-foreground: #ffffff;

  /* Surface colors */
  --cw-background: #ffffff;
  --cw-foreground: #0f172a;
  --cw-muted: #f1f5f9;
  --cw-muted-foreground: #64748b;

  /* Border */
  --cw-border: #e2e8f0;
  --cw-border-radius: 0.5rem;

  /* Typography */
  --cw-font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --cw-font-size: 14px;
  --cw-line-height: 1.5;

  /* Spacing */
  --cw-spacing-xs: 0.25rem;
  --cw-spacing-sm: 0.5rem;
  --cw-spacing-md: 1rem;
  --cw-spacing-lg: 1.5rem;
  --cw-spacing-xl: 2rem;

  /* Widget dimensions */
  --cw-widget-width: 400px;
  --cw-widget-height: 600px;
  --cw-widget-bottom: 20px;
  --cw-widget-right: 20px;

  /* Trigger button */
  --cw-trigger-size: 56px;
  --cw-trigger-bg: var(--cw-primary);
  --cw-trigger-fg: var(--cw-primary-foreground);
  --cw-trigger-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

  /* Header */
  --cw-header-bg: var(--cw-primary);
  --cw-header-fg: var(--cw-primary-foreground);
  --cw-header-height: 56px;

  /* Messages */
  --cw-msg-user-bg: var(--cw-primary);
  --cw-msg-user-fg: var(--cw-primary-foreground);
  --cw-msg-bot-bg: var(--cw-muted);
  --cw-msg-bot-fg: var(--cw-foreground);
  --cw-msg-radius: 1rem;

  /* Input */
  --cw-input-bg: var(--cw-background);
  --cw-input-fg: var(--cw-foreground);
  --cw-input-border: var(--cw-border);
  --cw-input-placeholder: var(--cw-muted-foreground);

  /* Bubble notification */
  --cw-bubble-bg: var(--cw-background);
  --cw-bubble-fg: var(--cw-foreground);
  --cw-bubble-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);

  /* Animation */
  --cw-transition-duration: 200ms;
  --cw-transition-easing: cubic-bezier(0.4, 0, 0.2, 1);

  /* Z-index — high but not max-int to coexist with other overlays */
  --cw-z-index: 2147483000;
}
`;
