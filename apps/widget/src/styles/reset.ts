/**
 * CSS reset for Shadow DOM — blocks host page CSS inheritance.
 *
 * Shadow DOM blocks scoped selectors from the host page, but CSS *inherited*
 * properties (font-family, color, text-transform, etc.) still leak through
 * from the host element. This reset blocks those inheritable properties
 * while letting Tailwind handle visual styling (backgrounds, borders, etc.).
 */
export const resetCSS = `
:host {
  all: initial;
  display: block;
  visibility: visible;
  direction: ltr;
  writing-mode: horizontal-tb;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.cw-widget-root {
  /* Block inherited properties from host page — these leak through Shadow DOM */
  font-family: var(--cw-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  font-size: var(--cw-font-size, 14px);
  font-style: normal;
  font-weight: 400;
  font-variant: normal;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-decoration: none;
  text-indent: 0;
  text-shadow: none;
  text-align: left;
  color: var(--cw-foreground, #1f2937);
  direction: ltr;
  writing-mode: horizontal-tb;
  white-space: normal;
  word-break: normal;
  overflow-wrap: break-word;
  cursor: default;
  visibility: visible;
  -webkit-tap-highlight-color: transparent;
  /* Ensure Tailwind utilities win over host page !important on inherited props */
  pointer-events: none;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}
`;
