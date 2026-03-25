/** Component CSS strings — minimal stubs, expanded in later stories */
export const componentCSS = `
.cw-widget-root {
  pointer-events: none;
}

.cw-widget {
  font-family: var(--cw-font-family, Inter, system-ui, sans-serif);
  font-size: var(--cw-font-size, 14px);
  line-height: var(--cw-line-height, 1.5);
  color: var(--cw-foreground, #1f2937);
  position: fixed;
  bottom: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-bottom, 0px));
  right: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-right, 0px));
  z-index: var(--cw-z-index, 2147483000);
}

.cw-widget[data-position="left"] {
  right: auto;
  left: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-left, 0px));
}

/* ── Trigger Button ────────────────────────────────────────────────── */

.cw-trigger-button {
  pointer-events: auto;
  width: var(--cw-trigger-size, 64px);
  height: var(--cw-trigger-size, 64px);
  border-radius: var(--cw-trigger-radius, 50%);
  border: none;
  cursor: pointer;
  background: var(--cw-trigger-bg, #3b82f6);
  color: var(--cw-trigger-fg, #ffffff);
  box-shadow: var(--cw-trigger-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 150ms ease;
  outline: none;
}

.cw-trigger-button:hover {
  transform: scale(1.1);
}

.cw-trigger-button:focus-visible {
  outline: 2px solid var(--cw-primary, #3b82f6);
  outline-offset: 2px;
}

.cw-trigger-button:active {
  transform: scale(0.95);
}

/* Custom icon image */
.cw-trigger-custom-icon {
  width: 60%;
  height: 60%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
}

/* Default SVG icon */
.cw-trigger-icon {
  pointer-events: none;
}

/* Optional pulse animation */
.cw-trigger-pulse {
  animation: cw-pulse 2s ease-in-out infinite;
}

@keyframes cw-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.cw-trigger-pulse:hover {
  animation: none;
  transform: scale(1.1);
}

/* ── Chat Window ───────────────────────────────────────────────────── */

.cw-chat-window {
  pointer-events: auto;
  width: var(--cw-widget-width, 400px);
  height: var(--cw-widget-height, 600px);
  background: var(--cw-background, #ffffff);
  border-radius: var(--cw-border-radius, 0.5rem);
  border: 1px solid var(--cw-border, #e5e7eb);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: contain;
}

/* ── Bubble Notification ───────────────────────────────────────────── */

.cw-bubble-notification {
  pointer-events: auto;
  background: var(--cw-bubble-bg, #ffffff);
  color: var(--cw-bubble-fg, #1f2937);
  box-shadow: var(--cw-bubble-shadow, 0 4px 16px rgba(0, 0, 0, 0.12));
  border-radius: var(--cw-border-radius, 0.5rem);
  padding: var(--cw-spacing-sm, 0.5rem) var(--cw-spacing-md, 1rem);
  max-width: 280px;
  margin-bottom: var(--cw-spacing-sm, 0.5rem);
}
`;
