# Embeddable Chat Widget: CSS Isolation & Architecture Research

> **Date:** 2026-03-24
> **Purpose:** Definitive research for building a bulletproof embeddable chat widget that works on ANY customer website without CSS/layout interference
> **Context:** CodeWeaves widget — Preact + Vite, 50+ theme properties, deployed on thousands of sites

---

## Table of Contents

1. [The #1 Finding: How Production Widgets Actually Do It](#1-the-1-finding)
2. [Architecture Decision: Shadow DOM vs iframe vs Hybrid](#2-architecture-decision)
3. [Shadow DOM Isolation — The Complete Playbook](#3-shadow-dom-isolation)
4. [Z-Index & Stacking Context Wars](#4-z-index-stacking)
5. [CSS Reset Inside Shadow Root](#5-css-reset)
6. [Theming with CSS Custom Properties](#6-theming)
7. [Styling Approach: Constructable Stylesheets](#7-styling-approach)
8. [Font Loading Across Shadow Boundary](#8-font-loading)
9. [Mobile-Specific Challenges](#9-mobile)
10. [Accessibility with Shadow DOM](#10-accessibility)
11. [Content Security Policy (CSP)](#11-csp)
12. [Host Page Conflict Scenarios](#12-host-conflicts)
13. [Script Loading & Initialization](#13-script-loading)
14. [Performance & Lazy Loading](#14-performance)
15. [Testing Strategy](#15-testing)
16. [Recommended Architecture for CodeWeaves](#16-recommendation)

---

## 1. The #1 Finding: How Production Widgets Actually Do It {#1-the-1-finding}

**Every major production chat widget uses iframes as the primary isolation mechanism:**

| Widget | Architecture | CSS Isolation | Z-Index |
|--------|-------------|---------------|---------|
| **Intercom** | iframe | Full iframe isolation | ~2,147,483,647 |
| **Drift** | iframe | Full iframe isolation | 2,147,483,647 |
| **Crisp** | iframe | Full iframe isolation | 1,000,000 |
| **Tidio** | iframe | Full iframe isolation | 999,999,999 |
| **Tawk.to** | iframe | Full iframe isolation | 2,000,000,000 |
| **Chatwoot** | iframe (chat) + direct DOM (button) | iframe + `.woot-` prefixed classes | 2,147,483,000 |
| **Zendesk** | iframe | Full iframe isolation | High fixed value |

**Open-source widgets:**

| Widget | Architecture | CSS Isolation |
|--------|-------------|---------------|
| **Chatwoot** | iframe (chat) + light DOM (button) | iframe isolation |
| **Botpress** | iframe | Full iframe isolation |
| **Typebot** | Custom Elements (SolidJS) | Scoped styles, no Shadow DOM |
| **Papercups** | iframe | Full iframe isolation |
| **Rocket.Chat** | iframe + Preact inside | Full iframe isolation |
| **n8n Chat** | Direct DOM injection (Vue 3) | **None** — CSS injected into host `<head>` |
| **Voiceflow** | Shadow DOM (embedded mode) | `.vfrc-` prefixes + Shadow DOM |

**Key insight:** 5 out of 8 open-source widgets and ALL major commercial widgets use iframes. The reason is simple — iframes provide **complete, browser-enforced isolation** with zero edge cases.

---

## 2. Architecture Decision: Shadow DOM vs iframe vs Hybrid {#2-architecture-decision}

### Option A: Pure Shadow DOM (Closed Mode)

**Pros:**
- Single execution context — direct API access, shared state, no postMessage
- Lighter weight — no iframe overhead
- Better for Preact rendering — direct DOM access
- CSS custom properties cross shadow boundary (great for theming)
- Preact works well with Shadow DOM (direct event listeners, not document-level delegation like React)

**Cons:**
- Inherited CSS properties leak through (font-family, color, line-height, cursor, direction, etc.)
- Requires explicit CSS reset (`all: initial`) which then requires re-declaring everything
- `@font-face` doesn't work inside Shadow DOM — must inject into light DOM
- ARIA IDREFs (`aria-labelledby`, `for`) don't cross shadow boundary
- `document.activeElement` returns host element in closed mode
- Some CSP configurations block inline `<style>` inside Shadow DOM (mitigated by constructable stylesheets)
- Form autofill/password managers may not detect inputs inside shadow DOM

### Option B: Pure iframe

**Pros:**
- Complete isolation — zero CSS leakage in either direction, guaranteed
- Zero edge cases — no inherited properties, no z-index conflicts within the iframe
- Works with any CSS framework inside (Tailwind, etc.)
- `@font-face` works normally
- Full accessibility support
- Full form autofill/password manager support

**Cons:**
- Communication requires postMessage bridge (adds complexity)
- Separate execution context — can't share state directly
- iframe resizing is complex (especially for dynamic content height)
- Cross-origin restrictions if widget served from different domain
- Slightly higher memory footprint
- Two bundles to load (host script + iframe content)

### Option C: Hybrid (Recommended by Industry)

**Shadow DOM for trigger button** + **iframe for chat window**

This is what Chatwoot does and is the pattern used by most production widgets:
- Trigger button is tiny, lightweight, and style-isolated via Shadow DOM
- Chat window gets complete iframe isolation — zero CSS conflicts
- postMessage bridge for communication between trigger and chat window
- Best of both worlds

### Our Decision: Shadow DOM (Option A) — With Battle-Hardened Protections

**Rationale:**
- Our architecture already specifies Preact + Shadow DOM, and Preact's event model is Shadow DOM-compatible
- We need tight theming control with 50+ CSS variables that naturally cross shadow boundary
- iframe adds significant complexity (postMessage bridge, iframe sizing, cross-origin) that Shadow DOM doesn't need
- The cons of Shadow DOM are all solvable with known techniques (documented below)
- Bundle size stays minimal (no iframe loader + content split)

**The trade-off:** We accept more implementation complexity upfront (CSS reset, font injection, accessibility workarounds) in exchange for a simpler runtime architecture and better theming integration.

**If Shadow DOM proves insufficient in production**, we have a clear fallback path to the hybrid approach — the trigger button stays in Shadow DOM, and we move the chat window to an iframe.

---

## 3. Shadow DOM Isolation — The Complete Playbook {#3-shadow-dom-isolation}

### 3.1 Creating the Shadow Root

```typescript
// shadow-dom.ts
export function createWidgetShadowRoot(hostElement: HTMLElement): ShadowRoot {
  const shadowRoot = hostElement.attachShadow({ mode: 'closed' });
  return shadowRoot;
}
```

**Why closed mode:**
- `mode: 'open'` exposes `element.shadowRoot` to any JS on the host page
- `mode: 'closed'` returns `null` for `element.shadowRoot` — host page JS cannot access internals
- Only our code holds a reference to the shadow root

### 3.2 Host Element Setup (Light DOM)

The host element sits in the light DOM and MUST be bulletproof:

```typescript
function createHostElement(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'codeweaves-widget-host';

  // Critical: These styles are on the LIGHT DOM element
  // They prevent host page CSS from affecting positioning
  const criticalStyles = [
    'position: fixed !important',
    'z-index: 2147483647 !important',   // max 32-bit int
    'bottom: 0 !important',
    'right: 0 !important',
    'width: auto !important',
    'height: auto !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: none !important',
    'background: transparent !important',
    'pointer-events: none !important',   // pass-through by default
    'isolation: isolate !important',     // new stacking context
    'transform: none !important',        // prevent stacking context issues
    'opacity: 1 !important',
    'overflow: visible !important',
    'display: block !important',
    'visibility: visible !important',
  ].join('; ');

  host.setAttribute('style', criticalStyles);
  document.body.appendChild(host);
  return host;
}
```

**Why `!important` on everything:** Host pages may have wildcard selectors like `* { margin: 0 }` or CSS frameworks that target all `div` elements. `!important` ensures our positioning is never overridden.

**Why `pointer-events: none`:** The host element covers a region of the page. With `pointer-events: none`, clicks pass through to the page. Individual interactive children (trigger button, chat window) set `pointer-events: auto`.

### 3.3 MutationObserver Protection

Some host page scripts may try to modify our host element's styles:

```typescript
function protectHostElement(host: HTMLElement): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        // Re-apply critical styles if tampered with
        host.setAttribute('style', criticalStyles);
      }
    }
  });

  observer.observe(host, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
}
```

---

## 4. Z-Index & Stacking Context Wars {#4-z-index-stacking}

### The Problem

Host pages use z-index values ranging from 1 to 2,147,483,647. Common offenders:
- Cookie consent banners: z-index 9999-999999
- Modal overlays: z-index 1000-10000
- Sticky headers: z-index 100-1000
- WordPress admin bar: z-index 99999
- Bootstrap modals: z-index 1050
- Shopify themes: various high values

### The Solution

1. **Use maximum 32-bit integer:** `z-index: 2147483647` (what Drift uses)
2. **`isolation: isolate`** on host element — creates a new stacking context so internal z-index values don't compete with the host page
3. **`position: fixed`** (not `absolute`) — removes from document flow entirely
4. **Mount directly on `document.body`** — avoids being trapped in a parent's stacking context

### Internal Z-Index Scale

Inside the shadow root, use a relative scale:

```css
/* Inside shadow root */
.widget-trigger     { z-index: 1; }
.widget-bubble      { z-index: 2; }
.widget-chat-window { z-index: 3; }
.widget-overlay      { z-index: 4; }  /* if needed */
```

Since the host element has `isolation: isolate`, these internal values don't leak out.

---

## 5. CSS Reset Inside Shadow Root {#5-css-reset}

### The Problem

Shadow DOM blocks external stylesheets from affecting shadow content. BUT these CSS properties are **inherited** and DO leak through:

- `font-family`, `font-size`, `font-style`, `font-weight`
- `color`
- `line-height`, `letter-spacing`, `word-spacing`
- `text-align`, `text-indent`, `text-transform`
- `white-space`, `word-break`, `word-wrap`
- `direction`, `writing-mode`
- `cursor`
- `visibility`
- `list-style`
- And ~40 more inherited properties

### The Solution: `:host` Reset

```css
:host {
  /* Nuclear reset — blocks ALL inherited properties */
  all: initial;

  /* Re-declare what we need */
  display: block;
  box-sizing: border-box;
  visibility: visible;

  /* Inherit direction/writing-mode for RTL support */
  direction: inherit;
  writing-mode: inherit;
}

/* Apply our base styles to the widget container */
.cw-widget-root {
  font-family: var(--cw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
  font-size: var(--cw-font-size-base, 14px);
  line-height: var(--cw-line-height-base, 1.5);
  color: var(--cw-color-text, #1a1a2e);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  box-sizing: border-box;
  pointer-events: auto;
}

/* Ensure box-sizing cascades to all children */
.cw-widget-root *,
.cw-widget-root *::before,
.cw-widget-root *::after {
  box-sizing: border-box;
}
```

### What `all: initial` Does and Doesn't Do

**Does:**
- Resets every CSS property to its initial value (per CSS spec)
- Blocks inherited properties from the host page
- Effectively creates a clean slate

**Doesn't:**
- Reset CSS custom properties (they still inherit — which is what we WANT for theming)
- Reset `direction` (we explicitly re-inherit it)
- Handle `display` correctly (initial value is `inline`, we need `block`)

---

## 6. Theming with CSS Custom Properties {#6-theming}

### Why CSS Variables Are Perfect for Shadow DOM Widgets

CSS custom properties (variables) are the ONLY CSS feature that inherits across shadow boundaries by design. This is intentional in the spec — it's the official theming mechanism for web components.

### Namespace Convention

All variables use `--cw-` prefix to avoid conflicts with host page variables:

```css
/* Theme variables — set on :host or injected dynamically */
:host {
  /* Colors */
  --cw-color-primary: #007bff;
  --cw-color-primary-hover: #0056b3;
  --cw-color-background: #ffffff;
  --cw-color-surface: #f8f9fa;
  --cw-color-text: #1a1a2e;
  --cw-color-text-secondary: #6c757d;
  --cw-color-border: #e0e0e0;
  --cw-color-user-bubble: #007bff;
  --cw-color-user-text: #ffffff;
  --cw-color-bot-bubble: #f0f0f5;
  --cw-color-bot-text: #1a1a2e;

  /* Typography */
  --cw-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --cw-font-size-base: 14px;
  --cw-font-size-sm: 12px;
  --cw-font-size-lg: 16px;
  --cw-line-height-base: 1.5;

  /* Spacing */
  --cw-spacing-xs: 4px;
  --cw-spacing-sm: 8px;
  --cw-spacing-md: 12px;
  --cw-spacing-lg: 16px;
  --cw-spacing-xl: 24px;

  /* Border radius */
  --cw-radius-sm: 4px;
  --cw-radius-md: 8px;
  --cw-radius-lg: 12px;
  --cw-radius-full: 9999px;

  /* Shadows */
  --cw-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
  --cw-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
  --cw-shadow-lg: 0 8px 30px rgba(0, 0, 0, 0.2);

  /* Layout */
  --cw-chat-width: 380px;
  --cw-chat-height: 520px;
  --cw-chat-max-height: 80vh;
  --cw-trigger-size: 64px;
  --cw-header-height: 56px;

  /* Animation */
  --cw-transition-fast: 150ms ease;
  --cw-transition-normal: 300ms ease;
  --cw-transition-slow: 500ms ease;
}
```

### Dynamic Theme Application

When config loads from API, update variables at runtime:

```typescript
function applyTheme(shadowRoot: ShadowRoot, theme: ThemeConfig): void {
  const host = shadowRoot.host as HTMLElement;

  // Map theme config to CSS variables
  const variableMap: Record<string, string> = {
    '--cw-color-primary': theme.primaryColor,
    '--cw-color-background': theme.backgroundColor,
    '--cw-color-user-bubble': theme.userBubbleColor,
    '--cw-color-bot-bubble': theme.botBubbleColor,
    '--cw-font-family': theme.fontFamily,
    '--cw-radius-md': theme.borderRadius,
    '--cw-trigger-size': `${theme.triggerSize}px`,
    // ... map all 50+ properties
  };

  // Apply only defined values (keep defaults for undefined)
  for (const [variable, value] of Object.entries(variableMap)) {
    if (value !== undefined && value !== null) {
      host.style.setProperty(variable, value);
    }
  }
}
```

### Performance

50+ CSS variables have **negligible performance impact** in modern browsers. The CSS engine resolves variables during style computation, which is O(1) per property lookup. Even 200+ variables would be fine.

---

## 7. Styling Approach: Constructable Stylesheets {#7-styling-approach}

### Why Constructable Stylesheets Over `<style>` Tags

| Approach | Performance | CSP Compatible | Dynamic Updates |
|----------|-------------|----------------|-----------------|
| **Constructable Stylesheets** | Best — shared parsed CSSOM | Yes — bypasses `style-src` | `replaceSync()` |
| **`<style>` tags** | Good — re-parsed per shadow root | **No** — blocked by strict CSP | Replace innerHTML |
| **Inline styles** | Poor at scale | Yes | Direct manipulation |
| **CSS Modules** | Good — build-time | Depends on injection method | N/A |

**Constructable Stylesheets win decisively** because:
1. They're NOT blocked by CSP `style-src` restrictions (this is the #1 deployment blocker for enterprise customers)
2. Fastest performance — the stylesheet is parsed once and shared
3. Clean dynamic update API via `replaceSync()`

### Browser Support (2026)

- Chrome 73+ ✅
- Firefox 101+ ✅
- Safari 16.4+ ✅
- Edge 79+ ✅
- **~95% global support — no polyfill needed**

### Implementation Pattern

```typescript
// styles/create-stylesheet.ts
export function createStylesheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

// styles/index.ts — 3-sheet architecture
import { resetCSS } from './reset';
import { themeCSS } from './theme';
import { componentCSS } from './components';

export function applyStyles(shadowRoot: ShadowRoot): void {
  const resetSheet = createStylesheet(resetCSS);
  const themeSheet = createStylesheet(themeCSS);
  const componentSheet = createStylesheet(componentCSS);

  shadowRoot.adoptedStyleSheets = [resetSheet, themeSheet, componentSheet];
}

// To update theme dynamically:
export function updateThemeSheet(shadowRoot: ShadowRoot, newThemeCSS: string): void {
  // Replace only the theme sheet (index 1), keep reset and components
  shadowRoot.adoptedStyleSheets[1].replaceSync(newThemeCSS);
}
```

### 3-Sheet Architecture

1. **Reset sheet** — `:host { all: initial }`, box-sizing reset, base typography
2. **Theme sheet** — CSS variable declarations on `:host`, overridden dynamically per agent config
3. **Component sheet** — All component styles referencing `var(--cw-*)` variables

This separation means theme changes only reparse the theme sheet, not all component styles.

---

## 8. Font Loading Across Shadow Boundary {#8-font-loading}

### The Problem

`@font-face` declarations **do not work inside Shadow DOM**. The browser ignores them. This is a known spec limitation.

### The Solution

Inject font declarations into the light DOM (document head):

```typescript
function loadWidgetFonts(fontFamily: string, fontUrl?: string): void {
  // Skip if no custom font specified
  if (!fontUrl) return;

  // Check if already loaded
  if (document.querySelector(`link[data-cw-font="${fontFamily}"]`)) return;

  // Option 1: Google Fonts or external URL
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = fontUrl;
  link.dataset.cwFont = fontFamily;
  document.head.appendChild(link);

  // Option 2: FontFace API (programmatic, more control)
  // const font = new FontFace(fontFamily, `url(${fontUrl})`);
  // font.load().then(() => document.fonts.add(font));
}
```

### Default Strategy

Use system font stack as default (zero network cost):

```css
--cw-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
  'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji',
  'Segoe UI Emoji';
```

Only load custom fonts when the agent config specifies one. Use `FontFace` API with a 3-second timeout — fall back to system fonts if loading fails.

---

## 9. Mobile-Specific Challenges {#9-mobile}

### 9.1 iOS Safari Virtual Keyboard

**The #1 mobile pain point.** iOS Safari does NOT resize the layout viewport when the keyboard opens. The widget input can get hidden behind the keyboard.

**Solution: VisualViewport API**

```typescript
function handleMobileKeyboard(): void {
  if (!window.visualViewport) return;

  window.visualViewport.addEventListener('resize', () => {
    const viewport = window.visualViewport!;
    const keyboardHeight = window.innerHeight - viewport.height;

    if (keyboardHeight > 100) {
      // Keyboard is open — adjust widget position
      chatWindow.style.transform = `translateY(-${keyboardHeight}px)`;
      chatWindow.style.maxHeight = `${viewport.height - 20}px`;
    } else {
      // Keyboard closed — reset
      chatWindow.style.transform = '';
      chatWindow.style.maxHeight = '';
    }
  });
}
```

### 9.2 Viewport Height

```css
/* Use svh (small viewport height) as base, not dvh (causes jank during toolbar animation) */
.cw-chat-fullscreen {
  height: 100svh;
  height: 100vh; /* fallback for older browsers */
}
```

### 9.3 Scroll Locking

When the chat window is open on mobile, prevent background page scrolling:

```typescript
function lockScroll(): void {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
}

function unlockScroll(): void {
  const scrollY = parseInt(document.body.style.top || '0') * -1;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, scrollY);
}
```

**Note:** `overflow: hidden` on `<body>` does NOT work on iOS Safari 15+. The `position: fixed` technique is required.

### 9.4 Overscroll Containment

Prevent scroll chaining (scrolling inside chat shouldn't scroll the page):

```css
.cw-messages-container {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

### 9.5 Mobile Layout

On screens < 480px, go fullscreen:

```css
@media (max-width: 480px) {
  .cw-chat-window {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100svh;
    border-radius: 0;
  }
}
```

### 9.6 Safe Area Insets (Notched Devices)

```css
.cw-widget-trigger {
  bottom: calc(var(--cw-spacing-lg) + env(safe-area-inset-bottom, 0px));
  right: calc(var(--cw-spacing-lg) + env(safe-area-inset-right, 0px));
}
```

---

## 10. Accessibility with Shadow DOM {#10-accessibility}

### Screen Readers

Screen readers (NVDA, JAWS, VoiceOver) **DO traverse Shadow DOM** — they see the composed/flattened tree. Content inside shadow roots IS announced.

### ARIA Across Shadow Boundary

**ARIA IDREFs (`aria-labelledby`, `aria-describedby`, `for`) do NOT cross shadow boundaries.** The referenced ID must be within the same shadow root.

**Solution:** Use `aria-label` strings instead of IDREFs:

```jsx
// ❌ Broken — ID reference won't resolve across shadow boundary
<input aria-labelledby="my-label" />

// ✅ Works — self-contained label
<input aria-label="Type your message" />
```

### Focus Management

```typescript
// document.activeElement returns the HOST element in closed mode
// Use shadowRoot.activeElement to get the actual focused element

function getFocusedElement(shadowRoot: ShadowRoot): Element | null {
  return shadowRoot.activeElement;
}

// Focus trapping in chat window
function trapFocus(shadowRoot: ShadowRoot, container: HTMLElement): void {
  const focusableElements = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusableElements[0] as HTMLElement;
  const last = focusableElements[focusableElements.length - 1] as HTMLElement;

  container.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && shadowRoot.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && shadowRoot.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape') {
      // Close chat window, restore focus to trigger button
    }
  });
}
```

### Required ARIA Attributes

```jsx
// Chat window
<div role="dialog" aria-modal="true" aria-label="Chat with support">

// Message list
<div role="log" aria-live="polite" aria-label="Chat messages">

// New message announcement
<div role="status" aria-live="assertive" class="sr-only">
  New message from assistant
</div>

// Trigger button
<button aria-label="Open chat" aria-expanded={isOpen}>

// Input
<input aria-label="Type your message" />
```

---

## 11. Content Security Policy (CSP) {#11-csp}

### The #1 Enterprise Deployment Blocker

Many enterprise sites have strict CSP headers. If our widget violates CSP, it silently fails.

### Key Finding

- **Inline `<style>` tags inside Shadow DOM ARE blocked** by `style-src` restrictions
- **Constructable Stylesheets (`adoptedStyleSheets`) are NOT blocked** by CSP
- This is the primary reason to use constructable stylesheets over `<style>` tags

### CSP Directives Customers Need

```
script-src: cdn.codeweaves.com (or wherever widget.js is hosted)
connect-src: api.codeweaves.com (for API calls and SSE streaming)
img-src: *.supabase.co (for agent avatars/logos, if using Supabase storage)
font-src: fonts.gstatic.com (only if using Google Fonts)
```

### Documentation for Customers

Provide a clear CSP guide:
```
If your site uses Content Security Policy headers, add these directives:
  script-src 'self' https://cdn.codeweaves.com;
  connect-src 'self' https://api.codeweaves.com;
  img-src 'self' https://*.supabase.co;
```

---

## 12. Host Page Conflict Scenarios {#12-host-conflicts}

### What Shadow DOM Protects Against (automatically)

| Attack Vector | Protected? |
|--------------|------------|
| Host CSS classes/IDs targeting widget | ✅ Yes |
| Host CSS tag selectors (`button { }`) | ✅ Yes |
| `* { box-sizing: border-box }` | ✅ Yes |
| CSS resets (normalize.css, reset.css) | ✅ Yes |
| `!important` on wildcard selectors | ✅ Yes |
| Bootstrap/Tailwind/Material UI styles | ✅ Yes |
| jQuery UI overlay/dialog styles | ✅ Yes |

### What Shadow DOM Does NOT Protect Against

| Attack Vector | Protection Required |
|--------------|-------------------|
| Inherited properties (font, color, etc.) | `all: initial` on `:host` |
| Host page JS modifying host element | MutationObserver |
| Host page setting `display: none !important` on `*` | `!important` on host styles |
| Z-index wars with modals/overlays | `z-index: 2147483647` |
| `overflow: hidden` on `<body>` | `position: fixed` on host |
| Host page removing our host element | MutationObserver on `document.body` |

### WordPress-Specific

WordPress themes and plugins are the most common conflict source:
- WooCommerce modals (z-index 999999)
- GDPR cookie plugins (z-index varies wildly)
- Page builders (Elementor, Divi) with aggressive CSS
- Admin bar (z-index 99999)

**All handled by our z-index: 2147483647 + Shadow DOM isolation.**

### Shopify-Specific

Shopify themes use Dawn (default) which is relatively clean, but:
- Cart drawer overlays (z-index varies)
- Quick-buy modals
- Announcement bars

**Same protections apply.**

---

## 13. Script Loading & Initialization {#13-script-loading}

### Recommended Pattern

```html
<script async src="https://cdn.codeweaves.com/widget.js" data-agent-id="abc123"></script>
```

### Initialization Flow

```typescript
// Entry point (main.tsx)
(function() {
  // 1. Singleton guard — prevent double-init
  if (window.__codeweaves_loaded) return;
  window.__codeweaves_loaded = true;

  // 2. Extract config from script tag
  const script = document.currentScript ||
    document.querySelector('script[data-agent-id]');
  const agentId = script?.getAttribute('data-agent-id');

  if (!agentId) {
    console.warn('[CodeWeaves] Missing data-agent-id attribute');
    return;
  }

  // 3. Wait for DOM ready
  function init() {
    // Create host element, shadow root, render app
    const host = createHostElement();
    const shadow = host.attachShadow({ mode: 'closed' });
    applyStyles(shadow);
    render(<Widget agentId={agentId} />, shadow);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Also expose manual init API
window.CodeWeaves = {
  init: (config: WidgetConfig) => { /* manual initialization */ },
  destroy: () => { /* cleanup */ },
  open: () => { /* open chat */ },
  close: () => { /* close chat */ },
};
```

### Two-Phase Lazy Loading (Optimization for Story 5-14)

1. **Phase 1 (~2-3KB):** Tiny loader script — creates trigger button, sets up click handler
2. **Phase 2 (~40-80KB):** Full widget bundle — loaded on first click or after idle

```typescript
// Loader (phase 1) — this is the initial <script>
function createTriggerOnly(agentId: string) {
  const host = createHostElement();
  const shadow = host.attachShadow({ mode: 'closed' });

  // Minimal trigger button with inline styles
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-label', 'Open chat');
  // Apply minimal styles...

  trigger.addEventListener('click', async () => {
    // Dynamically import the full widget
    const { initFullWidget } = await import('./widget-full.js');
    initFullWidget(shadow, agentId);
  }, { once: true });

  shadow.appendChild(trigger);
}
```

This keeps initial page load impact to ~2-3KB — well under the NFR4 (<200ms load) target.

---

## 14. Performance & Lazy Loading {#14-performance}

### Memory Leak Prevention

```typescript
// Cleanup on SPA navigation or widget destruction
function destroyWidget(
  host: HTMLElement,
  shadow: ShadowRoot,
  observers: MutationObserver[],
): void {
  // Disconnect all observers
  observers.forEach(o => o.disconnect());

  // Remove event listeners
  window.visualViewport?.removeEventListener('resize', handleResize);

  // Unmount Preact
  render(null, shadow);

  // Remove host element
  host.remove();

  // Clear singleton flag
  delete window.__codeweaves_loaded;
}
```

### SPA Navigation Handling

```typescript
// Detect navigation in SPAs (React Router, Next.js, etc.)
let currentUrl = window.location.href;

const urlObserver = new MutationObserver(() => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    // Widget survives navigation — just update state if needed
    // DO NOT re-initialize
  }
});

// Observe URL changes via history API
const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(this, args);
  window.dispatchEvent(new Event('cw-navigation'));
};
```

### Bundle Size Budget

| Component | Budget | Notes |
|-----------|--------|-------|
| Preact runtime | ~4KB gzip | Fixed cost |
| Shadow DOM + init | ~2KB gzip | Host setup, stylesheet adoption |
| Theme engine | ~3KB gzip | CSS variable management |
| UI components | ~25-35KB gzip | All chat UI |
| API/streaming client | ~5-8KB gzip | SSE, fetch, config loading |
| Voice UI (if included) | ~5-10KB gzip | Mic button, audio playback |
| **Total** | **~45-65KB gzip** | Well under 150KB NFR |

---

## 15. Testing Strategy {#15-testing}

### Playwright (Recommended)

Playwright pierces Shadow DOM by default — no special configuration needed:

```typescript
// Playwright test
test('widget opens on trigger click', async ({ page }) => {
  await page.goto('https://test-host-page.com');

  // Playwright automatically pierces shadow DOM
  await page.click('button[aria-label="Open chat"]');
  await expect(page.locator('[role="dialog"]')).toBeVisible();
});
```

### Test Harness Sites

Create test pages with different CSS frameworks:
- `test-bootstrap.html` — Bootstrap 5
- `test-tailwind.html` — Tailwind CSS
- `test-material.html` — Material UI
- `test-wordpress.html` — Simulated WordPress theme
- `test-shopify.html` — Simulated Shopify Dawn theme
- `test-aggressive-css.html` — `* { margin: 0 !important; color: red !important; }`
- `test-high-zindex.html` — Elements with z-index: 2147483647
- `test-csp-strict.html` — Strict CSP headers

### Real Device Testing

**Mandatory** for:
- iOS Safari keyboard behavior (VisualViewport API)
- Safe area insets on notched devices
- Android Chrome back button behavior
- Touch event handling

Use BrowserStack or similar — Playwright emulation doesn't accurately simulate iOS Safari viewport behavior.

---

## 16. Recommended Architecture for CodeWeaves {#16-recommendation}

### Summary

```
┌─────────────────────────────────────────┐
│ Host Page (customer's website)          │
│                                          │
│  ┌───────────────────────────────────┐  │
│  │ <div id="codeweaves-widget-host"> │  │
│  │ position: fixed; z-index: MAX     │  │
│  │ pointer-events: none              │  │
│  │                                    │  │
│  │  ┌─ Shadow Root (closed) ──────┐  │  │
│  │  │                              │  │  │
│  │  │ adoptedStyleSheets:          │  │  │
│  │  │  [reset, theme, components]  │  │  │
│  │  │                              │  │  │
│  │  │ ┌──────────────────────┐    │  │  │
│  │  │ │ Preact App           │    │  │  │
│  │  │ │                      │    │  │  │
│  │  │ │ • Trigger Button     │    │  │  │
│  │  │ │ • Bubble Notification│    │  │  │
│  │  │ │ • Chat Window        │    │  │  │
│  │  │ │   - Header           │    │  │  │
│  │  │ │   - Messages         │    │  │  │
│  │  │ │   - Starters         │    │  │  │
│  │  │ │   - Input            │    │  │  │
│  │  │ │   - Typing Indicator │    │  │  │
│  │  │ └──────────────────────┘    │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                          │
└─────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Isolation | Closed Shadow DOM | Preact-compatible, theming-friendly, simpler than iframe |
| Styling | Constructable Stylesheets | CSP-safe, best performance, dynamic updates |
| Theming | CSS custom properties (`--cw-*`) | Cross shadow boundary by design |
| CSS Reset | `all: initial` on `:host` | Blocks all inherited properties |
| Z-Index | 2147483647 + `isolation: isolate` | Maximum possible, own stacking context |
| Host Protection | `!important` on all host styles + MutationObserver | Survive aggressive host CSS |
| Fonts | Light DOM injection + system font default | `@font-face` doesn't work in Shadow DOM |
| Mobile | VisualViewport API + fullscreen on small screens | iOS keyboard handling |
| Bundle | 2-phase lazy load (2KB trigger → full widget on click) | Sub-200ms initial load |
| Fallback Plan | Hybrid (Shadow DOM button + iframe chat) | If Shadow DOM proves insufficient |

### Non-Negotiable Requirements

1. Widget MUST NOT affect host page styles in any way
2. Host page styles MUST NOT affect widget appearance
3. Widget MUST stay on top of all host page content
4. Widget MUST work with strict CSP headers
5. Widget MUST be accessible (WCAG 2.1 AA)
6. Widget MUST work on mobile (iOS Safari, Android Chrome)
7. Bundle MUST be < 150KB gzipped
8. Initial load MUST be < 200ms

---

## Sources

- [MDN: Using Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)
- [MDN: Constructable Stylesheets](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/CSSStyleSheet)
- [CompanyCam: Preact + Shadow DOM Widget](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)
- [Chatwoot IFrameHelper.js](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/sdk/IFrameHelper.js)
- [Alice Boxhall: Shadow DOM and Accessibility](https://alice.pages.igalia.com/blog/how-shadow-dom-and-accessibility-are-in-conflict/)
- [Nolan Lawson: Focus in Shadow DOM](https://nolanlawson.com/2021/02/13/managing-focus-in-the-shadow-dom/)
- [Rob Dodson: @font-face in Shadow DOM](https://robdodson.me/posts/at-font-face-doesnt-work-in-shadow-dom/)
- [Open WC: Styles Piercing Shadow DOM](https://open-wc.org/guides/knowledge/styling/styles-piercing-shadow-dom/)
- [Courier: Shadow DOM for Widget Isolation](https://www.courier.com/blog/how-to-use-the-shadow-dom-to-isolate-styles-on-a-dom-that-isnt-yours)
- [MakerKit: Embeddable React Widgets](https://makerkit.dev/blog/tutorials/embeddable-widgets-react)
