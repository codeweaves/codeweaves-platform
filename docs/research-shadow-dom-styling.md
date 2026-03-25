# Shadow DOM Styling Research for Embeddable Chat Widget

**Date:** 2026-03-24
**Context:** CodeWeaves widget (`apps/widget`) — Preact + Vite IIFE bundle, 50+ theme properties, embedded on customer sites via `<script>` tag.

---

## 1. Styling Approaches Inside Shadow DOM

### 1.1 Constructable Stylesheets (`adoptedStyleSheets`)

**How it works:** Create a `CSSStyleSheet` object in JS, set its rules, and attach it to a shadow root.

```ts
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .chat-window { background: var(--cw-bg, #fff); }
`);

shadowRoot.adoptedStyleSheets = [resetSheet, themeSheet, componentSheet];
```

**Pros:**
- Fastest approach — parsed once, shared across multiple shadow roots (zero duplication cost)
- Dynamic updates via `sheet.replaceSync()` or `sheet.replace()` (async, returns Promise)
- No DOM nodes created (no `<style>` element overhead)
- Deduplication: same sheet object referenced by multiple roots shares the parsed CSSOM

**Cons:**
- Cannot use `@import` inside constructable stylesheets (throws error)
- Slightly more verbose setup code

**Browser support (2026):** Universal — Chrome 73+, Firefox 101+, Safari 16.4+, Edge 73+. No polyfill needed.

**Verdict: RECOMMENDED as primary approach.** Best performance, cleanest dynamic theming.

### 1.2 `<style>` Tags Inside Shadow Root

```ts
const style = document.createElement('style');
style.textContent = `/* all CSS here */`;
shadowRoot.appendChild(style);
```

**Pros:**
- Works everywhere, simple mental model
- Can use `@import` (but blocks rendering)

**Cons:**
- Each shadow root gets its own `<style>` element — duplicated parsing if you have multiple widget instances
- Slight FOUC risk: content renders before style is parsed (mitigated by inserting style before other DOM)
- Updating requires replacing `textContent` which triggers full re-parse

**Verdict:** Acceptable fallback, but inferior to constructable stylesheets for our use case.

### 1.3 CSS Modules with Shadow DOM

CSS Modules are a build-time tool (Vite/webpack) that scopes class names. They produce either a `<style>` tag or a string. Inside Shadow DOM:

- You can import a CSS Module as a string and inject it into a `<style>` tag or constructable stylesheet
- Vite supports `?inline` suffix: `import styles from './styles.css?inline'`
- Class name scoping is redundant inside Shadow DOM (already isolated), but still useful for avoiding internal collisions in large stylesheets

```ts
import cssText from './widget.css?inline';

const sheet = new CSSStyleSheet();
sheet.replaceSync(cssText);
shadowRoot.adoptedStyleSheets = [sheet];
```

**Verdict:** Use Vite's `?inline` CSS imports to get CSS as strings, then feed into constructable stylesheets. Don't rely on CSS Modules' scoping — Shadow DOM already provides it.

### 1.4 Inline Styles via Preact

```tsx
<div style={{ backgroundColor: theme.bgColor, borderRadius: theme.radius }}>
```

**Pros:**
- No stylesheet management, reactive by nature
- TypeScript type safety on style properties

**Cons:**
- Cannot use pseudo-selectors (`:hover`, `:focus`, `::placeholder`)
- Cannot use media queries or container queries
- Cannot use `@keyframes` animations
- Verbose for 50+ properties — every component needs style prop drilling or context
- Slightly slower at scale: each element gets its own style attribute in the DOM
- No caching/sharing — browser cannot deduplicate inline styles

**Verdict:** Use sparingly for truly dynamic single-element overrides (e.g., user-specified avatar border color). Never as the primary styling approach.

### 1.5 Initial Render Performance Ranking

1. **Constructable Stylesheets** — parsed before first paint, zero DOM overhead
2. **`<style>` prepended to shadow root** — very close second, one DOM node
3. **Inline styles** — no parse step but more DOM weight
4. **`<style>` with `@import`** — blocks rendering, worst option

---

## 2. Constructable Stylesheets Deep Dive

### 2.1 Creation and Adoption

```ts
// Create sheets (do this ONCE at widget initialization)
const resetSheet = new CSSStyleSheet();
const themeSheet = new CSSStyleSheet();
const componentSheet = new CSSStyleSheet();

// Populate synchronously (blocking, use for small sheets)
resetSheet.replaceSync(resetCSS);

// Populate asynchronously (non-blocking, use for large sheets)
await themeSheet.replace(generateThemeCSS(config));

// Adopt — order matters (later sheets override earlier)
shadowRoot.adoptedStyleSheets = [resetSheet, themeSheet, componentSheet];
```

### 2.2 Dynamic Theme Updates

This is where constructable stylesheets truly shine for our 50+ property theming:

```ts
// APPROACH A: Replace the entire theme sheet (best for bulk theme changes)
function applyTheme(theme: WidgetTheme) {
  themeSheet.replaceSync(generateThemeCSS(theme));
  // All shadow roots using this sheet update automatically — zero DOM manipulation
}

// APPROACH B: Use CSS custom properties (best for individual property changes)
// Set variables on the host element; CSS inside the sheet references them
function updateThemeProperty(host: HTMLElement, prop: string, value: string) {
  host.style.setProperty(`--cw-${prop}`, value);
}
```

**Key insight:** `replaceSync` on a shared sheet updates ALL shadow roots that have adopted it simultaneously. This is extremely efficient for multi-instance scenarios (e.g., customer has two widgets on the same page).

### 2.3 Sharing Across Multiple Shadow Roots

```ts
// Single sheet instance — shared by reference
const sharedSheet = new CSSStyleSheet();
sharedSheet.replaceSync(css);

// Widget instance 1
shadowRoot1.adoptedStyleSheets = [sharedSheet];
// Widget instance 2
shadowRoot2.adoptedStyleSheets = [sharedSheet];

// Update once, both update:
sharedSheet.replaceSync(newCss);
```

The browser maintains a single parsed CSSOM. This is the primary performance advantage over `<style>` tags.

### 2.4 Browser Support (as of 2026)

| Browser | `new CSSStyleSheet()` | `adoptedStyleSheets` | Notes |
|---|---|---|---|
| Chrome | 73+ (Mar 2019) | 73+ | Full support |
| Edge | 79+ (Jan 2020) | 79+ | Chromium-based, same as Chrome |
| Firefox | 101+ (May 2022) | 101+ | Full support |
| Safari | 16.4+ (Mar 2023) | 16.4+ | Full support |
| Safari iOS | 16.4+ | 16.4+ | Full support |
| Samsung Internet | 11.1+ | 11.1+ | Full support |

**Global support: ~97%+ of browsers.** No polyfill needed in 2026. Any browser that doesn't support this is also unlikely to support Shadow DOM.

### 2.5 Polyfills (if needed for extreme edge cases)

- `construct-style-sheets-polyfill` — adds constructable stylesheet support, ~1.5KB
- Only needed if targeting very old Safari versions (pre-16.4), which is unlikely in 2026

**Recommendation:** Do not include a polyfill. Graceful degradation: fall back to `<style>` tag injection if `CSSStyleSheet` constructor throws.

```ts
function createStylesheet(css: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet;
  } catch {
    return null; // fallback to <style> tag
  }
}
```

---

## 3. Theming with CSS Custom Properties Inside Shadow DOM

### 3.1 The Key Insight: CSS Custom Properties Cross Shadow Boundaries

Unlike all other CSS properties, custom properties (CSS variables) **inherit across shadow DOM boundaries**. This is by design in the spec and is the foundation of Shadow DOM theming.

```
Document (light DOM)
  --cw-primary: #007bff    ← set here
    ↓ inherits into
  Shadow Root
    .button { color: var(--cw-primary) }  ← works!
```

This means the host page can theme your widget without accessing the shadow root:

```css
/* Customer's CSS */
codeweaves-widget {
  --cw-primary-color: #ff6600;
  --cw-font-family: 'Inter', sans-serif;
}
```

### 3.2 Namespacing Variables

Use a consistent prefix to avoid collision with the host page's variables:

```
Prefix: --cw-

Naming convention: --cw-{category}-{property}

Examples:
  --cw-color-primary
  --cw-color-primary-hover
  --cw-color-background
  --cw-color-surface
  --cw-color-text
  --cw-color-text-secondary
  --cw-color-border
  --cw-color-error
  --cw-color-success

  --cw-font-family
  --cw-font-size-sm
  --cw-font-size-base
  --cw-font-size-lg
  --cw-font-weight-normal
  --cw-font-weight-bold

  --cw-radius-sm
  --cw-radius-md
  --cw-radius-lg
  --cw-radius-full

  --cw-spacing-xs
  --cw-spacing-sm
  --cw-spacing-md
  --cw-spacing-lg

  --cw-shadow-sm
  --cw-shadow-md
  --cw-shadow-lg

  --cw-z-index-widget
  --cw-z-index-overlay

  --cw-transition-duration
  --cw-transition-easing
```

### 3.3 Default Values with Fallbacks

Every variable usage includes a default so the widget works without any theming:

```css
.chat-window {
  background: var(--cw-color-background, #ffffff);
  color: var(--cw-color-text, #1a1a1a);
  font-family: var(--cw-font-family, system-ui, -apple-system, sans-serif);
  border-radius: var(--cw-radius-lg, 12px);
  box-shadow: var(--cw-shadow-lg, 0 8px 30px rgba(0,0,0,0.12));
}
```

**Nested fallbacks for computed values:**

```css
.button-primary {
  /* Use hover color if set, otherwise darken primary */
  background: var(--cw-color-primary-hover, color-mix(in srgb, var(--cw-color-primary, #007bff) 85%, black));
}
```

### 3.4 Performance with 50+ Variables

CSS custom properties are resolved by the browser's style engine at computed-value time. Performance considerations:

- **50 variables is fine.** Browsers handle hundreds of custom properties without measurable perf impact. The CSS spec was designed for this.
- **Avoid long fallback chains:** `var(--a, var(--b, var(--c, red)))` — each level adds a tiny lookup. Keep to 1-2 levels max.
- **Batch updates:** When changing multiple properties, set them in one rAF cycle to trigger a single style recalculation:

```ts
function applyTheme(host: HTMLElement, theme: Partial<WidgetTheme>) {
  requestAnimationFrame(() => {
    for (const [key, value] of Object.entries(theme)) {
      host.style.setProperty(`--cw-${key}`, value);
    }
  });
}
```

### 3.5 Dynamic Theme Updates at Runtime

**Three approaches, in order of preference:**

**Approach 1: CSS custom properties on host element (BEST for per-property changes)**

```ts
// From widget JS — update specific properties
const host = document.querySelector('codeweaves-widget');
host.style.setProperty('--cw-color-primary', '#ff6600');
```

**Approach 2: Replace theme stylesheet (BEST for bulk theme swap)**

```ts
// Swap entire theme (e.g., light → dark mode)
themeSheet.replaceSync(generateThemeCSS(darkTheme));
```

**Approach 3: Hybrid (RECOMMENDED for CodeWeaves)**

Use constructable stylesheet for the base theme + component styles, and CSS custom properties for runtime overrides:

```ts
// Base theme in stylesheet (parsed once)
const themeCSS = `
  :host {
    --cw-color-primary: ${config.primaryColor || '#007bff'};
    --cw-color-background: ${config.backgroundColor || '#ffffff'};
    /* ... 50+ defaults from API config ... */
  }
`;
themeSheet.replaceSync(themeCSS);

// Runtime override (no re-parse needed)
function updateColor(prop: string, value: string) {
  hostElement.style.setProperty(`--cw-${prop}`, value);
}
```

### 3.6 Preventing Flash of Default Theme

The theme config is fetched from the API, so there's a network delay. Strategies:

**Strategy 1: Hide until theme loads (RECOMMENDED)**

```ts
// In the constructable stylesheet
const baseCSS = `
  :host { opacity: 0; transition: opacity 0.15s ease; }
  :host(.cw-ready) { opacity: 1; }
`;

// After theme + config loads
async function initWidget() {
  const config = await fetchWidgetConfig(agentId);
  applyTheme(hostElement, config.theme);
  shadowRoot.adoptedStyleSheets = [resetSheet, themeSheet, componentSheet];
  // Render Preact app into shadow root
  render(<App config={config} />, shadowRoot.querySelector('.cw-mount'));
  // Reveal
  hostElement.classList.add('cw-ready');
}
```

**Strategy 2: Inline critical theme in script tag**

```html
<script
  src="https://cdn.codeweaves.com/widget.js"
  data-agent-id="abc123"
  data-primary-color="#ff6600"
  data-bg-color="#1a1a1a"
></script>
```

Read `data-*` attributes synchronously before API call — gives instant theming for the most visible properties. API response fills in the rest.

**Strategy 3: Cache last-known theme in localStorage**

```ts
const cachedTheme = localStorage.getItem(`cw-theme-${agentId}`);
if (cachedTheme) {
  applyTheme(hostElement, JSON.parse(cachedTheme)); // instant
}
const freshTheme = await fetchConfig(agentId);
applyTheme(hostElement, freshTheme); // update if changed
localStorage.setItem(`cw-theme-${agentId}`, JSON.stringify(freshTheme));
```

**Recommendation:** Combine all three. `data-*` for instant critical properties, localStorage cache for repeat visits, API fetch for full config. Hide with `opacity: 0` only on first visit with no cache.

---

## 4. CSS Reset Strategies for Shadow DOM

### 4.1 Why a Reset is Needed

Shadow DOM blocks selector-based styles from the host page, but **inherited properties still leak through the shadow boundary**. These include:

- `color`
- `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `letter-spacing`, `word-spacing`
- `text-align`, `text-indent`, `text-transform`, `white-space`
- `direction`, `writing-mode`
- `visibility`
- `cursor`
- `quotes`
- `list-style-type`, `list-style-position`
- ALL CSS custom properties

If the host page sets `body { font-family: 'Comic Sans'; color: red; }`, your widget inherits those.

### 4.2 `all: initial` vs `all: revert` vs `all: unset`

| Keyword | What it does | For inherited props | For non-inherited props |
|---|---|---|---|
| `initial` | Sets to CSS spec initial value | `color: canvastext`, `font-size: medium` | `display: inline`, `margin: 0` |
| `unset` | Acts like `inherit` for inherited props, `initial` for non-inherited | Same as `inherit` (LEAKS host styles!) | Same as `initial` |
| `revert` | Reverts to browser's UA stylesheet | Browser default `color`, `font` | Browser default `display`, etc. |

**`all: initial` problem:** It resets `display` to `inline`, `visibility` to `visible`, `box-sizing` to `content-box`. You must re-declare these.

**`all: revert` problem:** Reverts to UA stylesheet which is browser-dependent. More predictable than `initial` for display values but less predictable across browsers.

**`all: unset` problem:** Inherited properties like `color` and `font` are NOT reset — they inherit from the host page. This defeats the purpose.

### 4.3 Recommended Reset Stylesheet

```css
/* === Shadow DOM Reset === */

:host {
  /* Block ALL inherited properties from host page */
  all: initial;

  /* Re-establish sane defaults that `all: initial` broke */
  display: block;
  box-sizing: border-box;
  visibility: visible;

  /* Establish widget's own typography baseline */
  font-family: var(--cw-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
  font-size: var(--cw-font-size-base, 14px);
  font-weight: var(--cw-font-weight-normal, 400);
  line-height: var(--cw-line-height, 1.5);
  color: var(--cw-color-text, #1a1a1a);

  /* Text rendering */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;

  /* Directionality — respect host page's direction */
  direction: inherit;
  writing-mode: inherit;

  /* Contain layout impact */
  contain: layout style;
}

/* Box-sizing reset for all elements inside shadow root */
*, *::before, *::after {
  box-sizing: border-box;
}

/* Prevent text size adjust on mobile */
:host {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
```

### 4.4 The `:host` Selector

`:host` targets the shadow host element (the custom element itself, e.g., `<codeweaves-widget>`). It is the shadow-root equivalent of styling the outer container.

- `:host` — always matches the host
- `:host(.dark)` — matches when host has class `dark`
- `:host([data-position="left"])` — matches attribute on host
- `:host-context(.rtl)` — matches when any ancestor has class `rtl` (useful for RTL)

**Important:** Styles set on the host from the light DOM (by the customer's CSS) have higher specificity than `:host` rules. This is intentional — it lets customers override widget positioning.

### 4.5 RTL Support

```css
/* Inherit direction from host page to support RTL sites */
:host {
  direction: inherit;
  writing-mode: inherit;
}

/* Or force a direction based on config */
:host([dir="rtl"]) {
  direction: rtl;
}

/* RTL-aware spacing using logical properties */
.message-bubble {
  margin-inline-start: 8px;  /* margin-left in LTR, margin-right in RTL */
  padding-inline: 12px;
  text-align: start;
}
```

**Use CSS logical properties throughout** (`margin-inline-start`, `padding-block-end`, `inset-inline-end`) instead of physical properties (`margin-left`, `padding-bottom`, `right`). This gives RTL support for free.

---

## 5. Animation and Transition Handling

### 5.1 CSS Animations

`@keyframes` declarations **must be inside the shadow root** — they do not inherit from the light DOM and light DOM keyframes are not visible inside the shadow root.

```css
/* Inside the shadow root's stylesheet */
@keyframes cw-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes cw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.chat-window {
  animation: cw-fade-in 0.2s ease-out;
}

.typing-dot {
  animation: cw-pulse 1.4s ease-in-out infinite;
}
```

**Gotcha:** If you dynamically add stylesheets, ensure `@keyframes` are in a sheet that's adopted BEFORE the elements referencing them are rendered. Otherwise, the first frame may not animate.

### 5.2 CSS Transitions

Transitions work normally inside shadow roots. No gotchas beyond the standard:

```css
.chat-window {
  transition: transform var(--cw-transition-duration, 0.2s) var(--cw-transition-easing, ease-out);
}
```

**Tip:** Use CSS custom properties for transition duration/easing so customers can adjust animation speed (or disable it).

### 5.3 `requestAnimationFrame` for JS Animations

Works identically inside shadow DOM. The shadow boundary is purely a CSS/DOM scoping mechanism — it does not affect JavaScript execution, `rAF`, `IntersectionObserver`, `ResizeObserver`, etc.

### 5.4 `prefers-reduced-motion`

Media queries work inside shadow roots. Always respect this preference:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Place this in the reset stylesheet so it applies globally within the widget.

---

## 6. Responsive Design Inside Shadow DOM

### 6.1 `@media` Queries Reference Viewport, Not Shadow Root

This is a critical gotcha. Inside shadow DOM, `@media (max-width: 768px)` checks the **viewport width**, not the widget's container width. This mostly works for our use case since:

- Widget is a floating overlay — its available space correlates with viewport size
- On mobile viewports (<768px), we want a full-screen chat experience
- On desktop viewports (>768px), we want a floating window

```css
/* Floating window on desktop */
.chat-window {
  width: 380px;
  height: 600px;
  position: fixed;
  inset-block-end: 80px;
  inset-inline-end: 20px;
  border-radius: var(--cw-radius-lg, 12px);
}

/* Full-screen on mobile */
@media (max-width: 480px) {
  .chat-window {
    width: 100%;
    height: 100%;
    inset: 0;
    border-radius: 0;
  }
}
```

### 6.2 CSS Container Queries (Preferred for Internal Layout)

Container queries let internal components respond to the **widget container's size** rather than the viewport. This is ideal for cases where the widget is embedded inline (not floating).

```css
/* Define the container */
.chat-window {
  container-type: inline-size;
  container-name: cw-chat;
}

/* Respond to container width */
@container cw-chat (max-width: 320px) {
  .message-actions { flex-direction: column; }
  .sidebar { display: none; }
}

@container cw-chat (min-width: 500px) {
  .chat-layout { grid-template-columns: 200px 1fr; }
}
```

**Browser support (2026):** Chrome 105+, Firefox 110+, Safari 16+, Edge 105+. Fully supported.

### 6.3 Mobile Virtual Keyboard Handling

The virtual keyboard on mobile pushes content up or resizes the viewport. This is one of the trickiest issues for chat widgets.

**Problem:** When the input field is focused, the keyboard appears and:
- On iOS Safari: the viewport height doesn't change but content scrolls
- On Android Chrome: the viewport shrinks (with `interactive-widget=resizes-content` meta)

**Solutions:**

```css
/* Use dvh (dynamic viewport height) to account for mobile browser chrome + keyboard */
@media (max-width: 480px) {
  .chat-window {
    height: 100dvh;
  }
}
```

```ts
// Listen for Virtual Keyboard API (Chrome 94+, progressive enhancement)
if ('virtualKeyboard' in navigator) {
  navigator.virtualKeyboard.overlaysContent = true;
  // Now use CSS env() variables
}
```

```css
/* When virtualKeyboard.overlaysContent = true */
.widget-input {
  padding-bottom: env(keyboard-inset-height, 0px);
}
```

**Fallback for Safari:** Use `visualViewport` API:

```ts
function handleKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;

  vv.addEventListener('resize', () => {
    const keyboardHeight = window.innerHeight - vv.height;
    hostElement.style.setProperty('--cw-keyboard-height', `${keyboardHeight}px`);
  });
}
```

```css
.chat-window {
  height: calc(100dvh - var(--cw-keyboard-height, 0px));
}
```

---

## 7. Font Handling Across Shadow DOM Boundary

### 7.1 The Problem: `@font-face` Doesn't Work Inside Shadow DOM

This is a well-known limitation. `@font-face` declarations inside a shadow root are **ignored by most browsers**. The font must be loaded in the light DOM (document level).

**Why:** Font resources are document-scoped. The browser's font cache is shared across the entire document, not per shadow root.

### 7.2 Loading Custom Fonts

**Approach 1: Inject a `<link>` into `<head>` from the widget (RECOMMENDED)**

```ts
function loadFont(fontUrl: string) {
  // Check if already loaded
  if (document.querySelector(`link[href="${fontUrl}"]`)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = fontUrl;
  document.head.appendChild(link);
}

// Usage
loadFont('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

**Approach 2: Use `FontFace` API (programmatic, no `<link>` needed)**

```ts
async function loadCustomFont(name: string, url: string, descriptors?: FontFaceDescriptors) {
  const font = new FontFace(name, `url(${url})`, descriptors);
  await font.load();
  document.fonts.add(font); // Must add to DOCUMENT, not shadow root
}

// Usage
await loadCustomFont('CustomBrand', 'https://cdn.example.com/fonts/brand.woff2', {
  weight: '400',
  style: 'normal',
  display: 'swap',
});
```

**Approach 3: Inject `@font-face` into a light-DOM `<style>` tag**

```ts
function injectFontFace(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

injectFontFace(`
  @font-face {
    font-family: 'AgentFont';
    src: url('https://cdn.codeweaves.com/fonts/agent-abc123.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
`);
```

After any of these approaches, the font is available inside the shadow root by name:

```css
/* Inside shadow root */
:host {
  font-family: var(--cw-font-family, 'Inter', system-ui, sans-serif);
}
```

### 7.3 Google Fonts Integration Pattern

```ts
function loadGoogleFont(family: string, weights: number[] = [400, 500, 600, 700]) {
  const weightStr = weights.join(';');
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weightStr}&display=swap`;

  // Preconnect for performance
  if (!document.querySelector('link[href="https://fonts.gstatic.com"]')) {
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://fonts.gstatic.com';
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
  }

  loadFont(url);
}
```

### 7.4 System Font Stack (Default — No Loading Needed)

```css
:host {
  font-family: var(--cw-font-family,
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    'Noto Sans',
    sans-serif,
    'Apple Color Emoji',
    'Segoe UI Emoji'
  );
}
```

This is the default. If the customer's config specifies a custom font, load it at initialization. The system stack ensures the widget looks native on every OS with zero network requests.

### 7.5 Graceful Font Fallback

```ts
async function loadFontWithFallback(config: { fontFamily?: string; fontUrl?: string }) {
  if (!config.fontFamily || !config.fontUrl) return; // Use system stack

  try {
    const font = new FontFace(config.fontFamily, `url(${config.fontUrl})`);
    const loaded = await Promise.race([
      font.load(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Font timeout')), 3000))
    ]);
    document.fonts.add(loaded as FontFace);
  } catch (err) {
    console.warn(`[CodeWeaves] Failed to load font "${config.fontFamily}", using system fonts`);
    // Widget continues with system font stack — no user-visible error
  }
}
```

---

## 8. Image and Asset Handling Inside Shadow DOM

### 8.1 Referencing Images

Inside shadow DOM, image URLs work normally — `<img src="...">` and `background-image: url(...)` resolve relative to the **document base URL**, not the shadow root.

For a CDN-deployed widget, always use absolute URLs:

```tsx
<img src="https://cdn.codeweaves.com/assets/logo.svg" alt="Agent" />
```

### 8.2 Inline SVGs vs External URLs

**Inline SVGs (RECOMMENDED for icons):**

```tsx
// Icons should be inline SVGs — no network request, instant render, themeable
function SendIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M2 10l7-7v4h9v6h-9v4L2 10z" fill={color} />
    </svg>
  );
}
```

**Advantages of inline SVGs:**
- Zero network requests
- Can be themed with `currentColor` or CSS custom properties
- No CORS issues
- Included in the JS bundle (negligible size for icons)

**External URLs (for larger/dynamic images):**

```tsx
// Agent avatar — loaded from API, use <img> with CDN URL
<img
  src={config.avatarUrl}
  alt={config.agentName}
  width={32}
  height={32}
  loading="lazy"
  onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR_DATA_URI; }}
/>
```

### 8.3 Base64 vs CDN URLs

| | Base64 | CDN URL |
|---|---|---|
| **Initial load** | Increases JS bundle size | Separate request but cacheable |
| **Caching** | Cached with JS bundle | Cached independently with long TTL |
| **Multiple uses** | Duplicated in HTML for each `<img>` | Single cached resource |
| **Best for** | Tiny icons (<1KB), fallback avatars | Agent avatars, logos, backgrounds |

**Recommendation:**
- **Base64:** Only for the default/fallback avatar and the widget launcher icon (tiny, critical-path)
- **CDN URLs:** For agent avatars, brand logos, background images

```ts
// Tiny fallback avatar as base64 (< 500 bytes)
const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIi...';

// Agent avatar from API — CDN URL
const agentAvatar = config.avatarUrl || DEFAULT_AVATAR;
```

### 8.4 Agent Avatar/Logo Loading Pattern

```tsx
import { useState } from 'preact/hooks';

const DEFAULT_AVATAR = 'data:image/svg+xml,...'; // inline SVG as data URI

function AgentAvatar({ src, name }: { src?: string; name: string }) {
  const [error, setError] = useState(false);
  const imgSrc = error || !src ? DEFAULT_AVATAR : src;

  return (
    <img
      class="cw-avatar"
      src={imgSrc}
      alt={name}
      width={32}
      height={32}
      onError={() => setError(true)}
    />
  );
}
```

```css
.cw-avatar {
  width: var(--cw-avatar-size, 32px);
  height: var(--cw-avatar-size, 32px);
  border-radius: var(--cw-radius-full, 9999px);
  object-fit: cover;
  flex-shrink: 0;
}
```

---

## 9. Recommended Architecture Summary

### Stylesheet Stack (3 constructable sheets, adopted in order):

```
shadowRoot.adoptedStyleSheets = [
  resetSheet,      // 1. CSS reset — blocks host inheritance, sets sane defaults
  themeSheet,      // 2. CSS custom property declarations on :host (from API config)
  componentSheet   // 3. All component styles referencing var(--cw-*) with fallbacks
];
```

### Theme Flow:

```
1. Script tag loads → read data-* attributes for instant critical theme props
2. Check localStorage for cached full theme
3. Apply cached/data-* theme immediately (no FOUC)
4. Fetch full config from API
5. Apply full theme, update cache
6. Add .cw-ready class → fade in widget
```

### Key Decisions:

| Decision | Choice | Rationale |
|---|---|---|
| Primary styling | Constructable Stylesheets | Best perf, shareable, dynamic updates |
| Theming mechanism | CSS custom properties (50+ `--cw-*` vars) | Inherit across shadow boundary, dynamic |
| Default values | `var(--cw-x, fallback)` in component CSS | Widget works with zero config |
| CSS reset | `all: initial` on `:host` + re-establish defaults | Full isolation from host |
| Icons | Inline SVGs with `currentColor` | Zero requests, themeable |
| Fonts | System stack default + `FontFace` API for custom | Load in document scope, use in shadow |
| Avatars/logos | CDN URLs with base64 fallback | Cacheable, graceful degradation |
| Responsive | `@media` for mobile/desktop + container queries for internal layout | Both needed |
| Animations | `@keyframes` in component stylesheet | Must be inside shadow root |
| RTL | CSS logical properties + `direction: inherit` | Automatic RTL support |
| `prefers-reduced-motion` | Respected via reset sheet | Accessibility requirement |
