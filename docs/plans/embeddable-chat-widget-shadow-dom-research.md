# Embeddable Chat Widget: Shadow DOM CSS Isolation Research

> Research Date: 2026-03-24
> Purpose: Production-grade CSS isolation for an embeddable SaaS chat widget

---

## Table of Contents

1. [Shadow DOM Closed Mode Best Practices](#1-shadow-dom-closed-mode-best-practices)
2. [Z-Index and Stacking Context Wars](#2-z-index-and-stacking-context-wars)
3. [How Production Chat Widgets Handle Isolation](#3-how-production-chat-widgets-handle-isolation)
4. [Known Shadow DOM Pitfalls](#4-known-shadow-dom-pitfalls)
5. [CSS Custom Properties Across Shadow Boundary](#5-css-custom-properties-across-shadow-boundary)
6. [Recommended Architecture](#6-recommended-architecture)

---

## 1. Shadow DOM Closed Mode Best Practices

### 1.1 Attaching a Closed Shadow Root

```javascript
class ChatWidget extends HTMLElement {
  #shadowRoot; // Private field - only way to access closed shadow root

  constructor() {
    super();
    this.#shadowRoot = this.attachShadow({ mode: 'closed' });
  }

  connectedCallback() {
    this.#shadowRoot.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="cw-widget-container">
        <!-- widget content -->
      </div>
    `;
  }
}
```

**Key points about `mode: 'closed'`:**
- `element.shadowRoot` returns `null` -- external JS cannot access internals
- `event.composedPath()` stops at the host element, not exposing internal targets
- Only your code (holding the `#shadowRoot` reference) can manipulate the DOM
- Google's general advice is to use `open` for most use cases, but for a **third-party embeddable widget**, `closed` is justified to prevent host page scripts from accidentally or intentionally breaking your widget

**Trade-off of closed mode:**
- Customers cannot debug CSS issues inside your widget (consider providing a debug mode toggle)
- `document.activeElement` returns the host element, not the actual focused element inside
- Some browser devtools still allow inspection of closed shadow roots (this is a devtools feature, not a security guarantee)

**Recommendation:** Use `mode: 'open'` for development and provide a build flag to switch to `closed` for production. This gives you debuggability in dev and protection in prod.

### 1.2 Preventing CSS Inheritance Into Shadow Root

Shadow DOM blocks **non-inherited** CSS properties from the host page. However, **inherited properties cascade INTO the shadow root**. This is the single biggest source of visual bugs for embeddable widgets.

**Properties that WILL leak into your shadow DOM:**
- `font-family`, `font-size`, `font-weight`, `font-style`, `font-variant`
- `color`
- `line-height`, `letter-spacing`, `word-spacing`
- `text-align`, `text-indent`, `text-transform`, `text-decoration`
- `white-space`, `word-break`, `word-wrap`, `overflow-wrap`
- `direction`, `unicode-bidi`
- `visibility`
- `cursor`
- `list-style`, `list-style-type`, `list-style-position`, `list-style-image`
- `quotes`
- `border-collapse`, `border-spacing` (table properties)
- `caption-side`, `empty-cells`
- `orphans`, `widows`
- `-webkit-text-fill-color`

### 1.3 The `all: initial` Reset Technique

```css
:host {
  all: initial;        /* Reset ALL CSS properties to their initial values */
  display: block;      /* Re-declare display since all:initial sets it to inline */
  contain: content;    /* Performance optimization */
}
```

**What `all: initial` does:**
- Resets every CSS property (including inherited ones like font-family, color, etc.) to the CSS specification's initial value
- `font-family` goes to browser default (usually Times New Roman / serif)
- `font-size` goes to `medium` (typically 16px)
- `color` goes to `canvastext` (usually black)
- `line-height` goes to `normal`
- `visibility` goes to `visible`
- `cursor` goes to `auto`

**Critical limitation: `all: initial` does NOT reset CSS custom properties (variables).**

This means if the host page defines `--primary-color: red`, that variable WILL be available inside your shadow DOM even after `all: initial`.

**Complete defensive reset pattern:**

```css
:host {
  /* Nuclear reset - blocks all inherited properties */
  all: initial;

  /* Re-establish what we need */
  display: block;
  box-sizing: border-box;

  /* Explicitly set our own values for commonly inherited properties */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  color: #1a1a1a;
  text-align: left;
  direction: ltr;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-indent: 0;
  text-decoration: none;
  white-space: normal;
  word-break: normal;
  overflow-wrap: normal;
  cursor: default;
  visibility: visible;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Reset all elements inside the shadow root */
:host *,
:host *::before,
:host *::after {
  box-sizing: border-box;
}
```

### 1.4 @font-face Declarations (THE BIG GOTCHA)

**`@font-face` declarations DO NOT WORK inside Shadow DOM.**

The shadow boundary prevents the browser from registering font-face definitions declared within a shadow root. This is a spec limitation, not a bug.

**Workaround 1: Inject @font-face into the light DOM (recommended)**

```javascript
class ChatWidget extends HTMLElement {
  #shadowRoot;
  static #fontsInjected = false;

  constructor() {
    super();
    this.#shadowRoot = this.attachShadow({ mode: 'closed' });
    this.#injectFonts();
  }

  #injectFonts() {
    // Only inject once, even if multiple widget instances exist
    if (ChatWidget.#fontsInjected) return;
    ChatWidget.#fontsInjected = true;

    const style = document.createElement('style');
    style.setAttribute('data-cw-fonts', '');
    style.textContent = `
      @font-face {
        font-family: 'CW-Inter';
        src: url('https://cdn.yourwidget.com/fonts/inter-var.woff2') format('woff2');
        font-weight: 100 900;
        font-display: swap;
      }
    `;
    document.head.appendChild(style);
  }
}
```

**Why prefix the font-family name (`CW-Inter` not `Inter`):**
- Prevents collision if the host page also loads Inter with different weights/subsets
- Clearly identifies which fonts belong to your widget
- Prevents the host page from accidentally depending on your font declarations

**Workaround 2: Use system font stack (simplest, no network requests)**

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
  'Helvetica Neue', Arial, sans-serif;
```

**Workaround 3: @font-face in both light DOM AND shadow root**

Some browsers (particularly older versions) need the @font-face in the shadow root as well for the font name to resolve. The safe approach is to declare it in both places:

```javascript
// Light DOM (for font loading)
document.head.appendChild(fontStyleElement);

// Shadow root (for font name resolution)
this.#shadowRoot.appendChild(fontStyleElement.cloneNode(true));
```

---

## 2. Z-Index and Stacking Context Wars

### 2.1 Z-Index Values Used by Production Chat Widgets

| Widget     | Default Z-Index      | Notes                                    |
|------------|----------------------|------------------------------------------|
| Tawk.to    | 2,000,000,000        | Configurable via JS API                  |
| Chatwoot   | 2,147,483,000        | Uses `!important`, near max int value    |
| Intercom   | 2,147,483,003        | Multiple iframes with different z-values |
| Drift      | 2,147,483,647        | Uses max 32-bit signed integer           |
| Crisp      | 1,000,000            | Lower than others                        |
| Tidio      | 999,999,999          | Configurable                             |

**The maximum z-index value is `2,147,483,647`** (max 32-bit signed integer). Using this value ensures nothing can stack above you with z-index alone.

### 2.2 Creating a Proper Stacking Context

```css
/* Widget host element */
:host {
  position: fixed;
  z-index: 2147483647;  /* Max 32-bit signed int */
  isolation: isolate;    /* Creates new stacking context */
}
```

**Why `isolation: isolate`:**
- Creates a new stacking context without side effects
- Prevents your internal z-index values from "leaking" into the host page's stacking context
- Your widget's internal layers (chat window, dropdowns, tooltips) use small z-index values (1-100) that are scoped to your stacking context

### 2.3 Handling Host Pages with Aggressive Z-Index

Some host pages use destructive patterns like:

```css
/* Hostile host page CSS */
* { z-index: 0 !important; }
/* or */
div { position: relative; z-index: 1; }
```

**Defenses:**

1. **Shadow DOM protects internal z-index values** -- the host page's `*` selector cannot reach inside your shadow root.

2. **The host element itself IS vulnerable** because it lives in the light DOM. Protect it:

```javascript
// After mounting, continuously enforce z-index on the host element
const observer = new MutationObserver(() => {
  hostElement.style.setProperty('z-index', '2147483647', 'important');
  hostElement.style.setProperty('position', 'fixed', 'important');
});

observer.observe(hostElement, {
  attributes: true,
  attributeFilter: ['style', 'class']
});
```

3. **Use a separate top-level container** for the expanded chat window:

```javascript
// Create widget at the VERY END of <body> to minimize stacking context traps
const container = document.createElement('div');
container.style.cssText = `
  position: fixed !important;
  z-index: 2147483647 !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  pointer-events: none !important;
`;
document.body.appendChild(container);
// Then attach shadow DOM to this container
```

### 2.4 Position Fixed vs. Position Absolute

**Always use `position: fixed` for the widget container.**

| Aspect           | `position: fixed`              | `position: absolute`            |
|------------------|--------------------------------|---------------------------------|
| Reference        | Viewport                       | Nearest positioned ancestor     |
| Scrolling        | Stays in place                 | Scrolls with parent             |
| Stacking context | Creates one when z-index set   | Creates one when z-index set    |
| Widget use case  | CORRECT for chat widget        | WRONG -- will scroll away       |

**Gotcha with `position: fixed`:** If ANY ancestor of your widget has `transform`, `perspective`, `filter`, `will-change`, or `contain: paint`, the `position: fixed` will be relative to THAT ancestor, not the viewport.

**Solution:** Mount the widget container directly on `document.body` (not inside any customer container) to avoid transform-containing ancestors:

```javascript
// ALWAYS append to body, never to a customer-specified container
document.body.appendChild(widgetHostElement);
```

### 2.5 Ensuring Widget Stays Above Modals, Cookie Banners, Sticky Navs

Common z-index ranges in the wild:
- Sticky navs: 100 - 1,000
- Dropdowns/tooltips: 1,000 - 10,000
- Modals/overlays: 10,000 - 100,000
- Cookie banners (OneTrust, CookieBot): 100,000 - 2,000,000,000
- Chat widgets: 2,000,000,000+

The key insight is that z-index only matters within the same stacking context. If a cookie banner creates its own stacking context at a lower level than your widget, your widget wins regardless of the banner's internal z-index.

---

## 3. How Production Chat Widgets Handle Isolation

### 3.1 Comparison Matrix

| Widget     | Primary Isolation | Secondary       | Open Source | Notes                            |
|------------|-------------------|-----------------|-------------|----------------------------------|
| Intercom   | **iframe**        | CSS classes     | No          | Multiple iframes for launcher + messenger |
| Drift      | **iframe**        | None            | No          | Heavy iframe-based approach      |
| Crisp      | **iframe**        | CSS classes     | No          | Plugin widgets use iframes       |
| Tidio      | **iframe**        | CSS prefixing   | No          | iframe with custom element wrapper |
| Chatwoot   | **iframe**        | CSS classes     | Yes         | IFrameHelper.js manages lifecycle |
| Tawk.to    | **iframe**        | CSS + JS API    | No          | iframe with configurable z-index |
| HubSpot    | **iframe**        | Shadow DOM      | No          | Hybrid approach                  |
| LiveChat   | **iframe**        | None            | No          | Traditional iframe embed         |

**Key finding: ALL major production chat widgets use iframes as their primary isolation mechanism.** None of them rely solely on Shadow DOM.

### 3.2 Intercom's Approach

Intercom creates multiple iframe elements:
- `.intercom-launcher-frame` -- the floating button/bubble
- `.intercom-messenger-frame` -- the expanded chat window
- `.intercom-borderless-frame` -- for tooltips and product tours

Each iframe has:
- `position: fixed` on the container div
- Extremely high z-index values (2,147,483,003)
- The chat content loads as a completely separate document inside the iframe
- Communication between the host page and iframe via `postMessage`

### 3.3 Chatwoot's Approach (Open Source Reference)

Chatwoot's implementation in `app/javascript/sdk/IFrameHelper.js`:

```javascript
// Creates an iframe element
const iframe = document.createElement('iframe');
iframe.src = widgetUrl;
iframe.allow = 'camera;microphone;fullscreen;display-capture;picture-in-picture;clipboard-write;';
iframe.id = 'chatwoot_live_chat_widget';

// Wraps in a holder div with positioning classes
// woot-widget-holder, woot-elements--{position}
// z-index: 2,147,483,000 via CSS
```

Key architectural elements:
- Widget content loads in iframe from Chatwoot server
- Bubble/launcher button is rendered in the light DOM with CSS class prefixing (`woot-widget-bubble`)
- Position managed via CSS classes (`woot-elements--left`, `woot-elements--right`)
- Communication via `postMessage` API
- Height dynamically adjusted via inline styles with `!important`

### 3.4 Crisp's Approach

Crisp uses iframes for their plugin widget system:
- Each plugin widget loads as a standalone web page in an iframe
- Parameters passed via GET query strings (`website_id`, `session_id`, `token`, `locale`)
- Max height of 300px before scrolling with expand option
- Uses `forwardEvent` method for iframe-to-modal communication
- Optional shared CSS (`widget.min.css`) for consistent Crisp styling

### 3.5 iframe vs Shadow DOM Trade-offs

| Aspect                    | iframe                         | Shadow DOM                      |
|---------------------------|--------------------------------|----------------------------------|
| **CSS isolation**         | Complete (separate document)   | Good but inherited props leak   |
| **JS isolation**          | Complete (separate context)    | None (same JS context)          |
| **Performance**           | Heavy (separate browsing ctx)  | Light (same document)           |
| **Communication**         | `postMessage` (async)          | Direct function calls           |
| **Bundle size**           | Separate load per iframe       | Single bundle                   |
| **SEO impact**            | None (iframes ignored)         | None (shadow DOM ignored)       |
| **Accessibility**         | Cross-frame a11y is hard       | Better but has ARIA issues      |
| **Form autofill**         | Works normally                 | Broken/limited                  |
| **Keyboard navigation**   | Tab enters/exits iframe        | Complex shadow boundary nav     |
| **Responsive design**     | Media queries = iframe size    | Media queries = viewport size   |
| **Third-party cookies**   | May be blocked (SameSite)      | Not applicable                  |
| **CSP restrictions**      | `frame-src` needed             | No special CSP needed           |
| **DevTools debugging**    | Separate context to switch to  | Inspectable in Elements panel   |
| **Memory overhead**       | Higher (separate document)     | Lower (shared document)         |
| **Load time**             | Slower (separate page load)    | Faster (inline rendering)       |

### 3.6 Recommended Hybrid Approach

Based on how production widgets work, the best approach for a SaaS chat widget is:

**Option A: Shadow DOM for launcher bubble + iframe for chat window (recommended)**

```
Host Page DOM
  |
  +-- <div> (appended to body, position: fixed, z-index: max)
       |
       +-- #shadow-root (closed)
            |
            +-- <button class="chat-bubble"> (launcher -- lightweight, Shadow DOM)
            +-- <iframe src="chat.yourapp.com/widget"> (chat window -- full iframe)
```

- The bubble/launcher is lightweight and benefits from Shadow DOM's low overhead
- The chat window has complex UI (message list, input, file upload, emoji picker) that benefits from complete iframe isolation
- The iframe loads your chat app as a standalone page
- Communication via `postMessage`

**Option B: Full Shadow DOM (lighter weight, more complexity)**

Use when:
- Bundle size is critical
- You need tight integration with the host page (e.g., reading page context)
- You can handle the inherited CSS edge cases

**Option C: Full iframe (maximum isolation, heaviest)**

Use when:
- You need to handle payments or sensitive data inside the widget
- CSP policies on customer sites are extremely restrictive
- You need absolute guarantee of no CSS/JS interference

---

## 4. Known Shadow DOM Pitfalls for Widgets

### 4.1 Form Elements

**Autofill/Autocomplete:**
- Browser autofill may not work for inputs inside shadow DOM
- Password managers (1Password, LastPass, Bitwarden) may not detect input fields inside shadow roots
- The HTML `autocomplete` attribute still works, but browser UI for autofill may not trigger

**Workaround:** For login/payment forms, use an iframe instead of shadow DOM.

### 4.2 Accessibility

**ARIA ID References Are Broken Across Shadow Boundaries:**

```html
<!-- THIS DOES NOT WORK across shadow boundary -->
<label for="chat-input">Message</label>  <!-- light DOM -->
<!-- shadow root -->
<input id="chat-input">  <!-- shadow DOM -- label can't find this -->
```

IDs are scoped to their shadow root. `aria-labelledby`, `aria-describedby`, `aria-activedescendant`, and `aria-controls` cannot reference elements across shadow boundaries.

**Solutions:**
- Keep all ARIA-related elements within the same shadow root
- Use `aria-label` (string value) instead of `aria-labelledby` (ID reference)
- Use `aria-live` regions for dynamic updates announced to screen readers

**Screen Readers:**
- Screen readers DO traverse into shadow DOM -- the accessibility tree is flattened
- The composed/flattened tree is what assistive technology sees
- This means screen readers generally work, but ARIA relationships between light and shadow DOM break

**Upcoming spec improvements:**
- Cross-root ARIA delegation (allows shadow roots to map host attributes to internal elements)
- Cross-root ARIA reflection (exports internal shadow DOM elements as relationship targets)
- Browser support is still incomplete as of 2026

### 4.3 Keyboard Navigation (Tab Order)

Tab order follows the **flattened DOM tree order** (depth-first traversal). Shadow DOM elements participate in tab order at the position of their host element.

**`delegatesFocus` option:**

```javascript
this.attachShadow({ mode: 'closed', delegatesFocus: true });
```

When `delegatesFocus: true`:
- Clicking a non-focusable part of the shadow DOM focuses the first focusable element inside
- The host element gets `:focus` styling
- `.focus()` on the host delegates to the first focusable child

**Gotcha:** You cannot implement a fully WAI-ARIA compliant modal dialog that contains elements with closed shadow roots (like `<video>` controls), because you can't enumerate their tabbable elements for focus trapping.

### 4.4 Event Retargeting

When events bubble out of shadow DOM, the `event.target` is retargeted to the host element:

```javascript
// Click on <button> inside shadow DOM
document.addEventListener('click', (e) => {
  console.log(e.target);          // <chat-widget> (the host element)
  console.log(e.composedPath());  // Full path including shadow internals
                                   // BUT only if mode: 'open'
});
```

**Events with `composed: true` (DO cross shadow boundary):**
- click, dblclick, mousedown, mouseup, mousemove
- keydown, keyup, keypress
- focus, blur (but retargeted)
- input, change
- touchstart, touchend, touchmove
- wheel, scroll
- All pointer events

**Events with `composed: false` (DO NOT cross shadow boundary):**
- mouseenter, mouseleave
- load, unload, abort, error
- select
- slotchange

**Custom events must opt in:**

```javascript
const event = new CustomEvent('widget-message-sent', {
  bubbles: true,
  composed: true,  // MUST be true to cross shadow boundary
  detail: { messageId: '123' }
});
this.dispatchEvent(event);
```

### 4.5 `document.activeElement` Behavior

With **open** shadow DOM:
```javascript
// If an input inside shadow DOM is focused:
document.activeElement;                          // <chat-widget>
document.activeElement.shadowRoot.activeElement;  // <input>
```

With **closed** shadow DOM:
```javascript
document.activeElement;           // <chat-widget>
document.activeElement.shadowRoot; // null (cannot drill in)
```

**Impact:** Third-party analytics or A/B testing scripts that track focus will only see the host element, not the actual focused element. This is usually fine for a chat widget (you don't want host page scripts knowing what your user typed).

### 4.6 Third-Party Scripts (Analytics, Error Tracking)

- **Error tracking (Sentry, Bugsnag):** Errors inside shadow DOM bubble up normally. Stack traces work. But the DOM breadcrumb trail may only show the host element.
- **Analytics click tracking:** Click events are retargeted. The host page's analytics will see clicks on `<chat-widget>`, not on internal buttons. Your widget should have its own analytics.
- **Heatmaps (Hotjar, FullStory):** May not record interactions inside shadow DOM, especially closed mode.
- **Session replay tools:** Support varies. Some modern tools (FullStory, LogRocket) have added shadow DOM support.

### 4.7 Media Queries Inside Shadow DOM

**Media queries in shadow DOM CSS respond to the VIEWPORT, not the shadow root container.**

```css
/* Inside shadow DOM -- this checks VIEWPORT width, not widget width */
@media (max-width: 768px) {
  .chat-window { width: 100vw; height: 100vh; }
}
```

There is no native CSS container query equivalent that works on the shadow host itself yet. Use container queries on internal wrapper elements:

```css
.widget-wrapper {
  container-type: inline-size;
}

@container (max-width: 350px) {
  .message-list { font-size: 13px; }
}
```

### 4.8 Scroll Behavior and Overflow

- Scroll events inside shadow DOM bubble up with `composed: true`
- `overflow: auto/scroll` works normally inside shadow root
- **Bug (Firefox):** Middle-click scrolling may not work over elements with shadow DOM when `overflow` is used on a grid parent
- Scroll position management (e.g., auto-scrolling to latest message) works normally via the private `#shadowRoot` reference

### 4.9 Touch Events on Mobile

All touch events (`touchstart`, `touchend`, `touchmove`, `touchcancel`) have `composed: true` and cross shadow boundaries. Mobile interactions generally work well with Shadow DOM.

**Potential issues:**
- iOS Safari may have inconsistent behavior with `position: fixed` elements inside shadow DOM when the virtual keyboard opens
- Safe area insets (`env(safe-area-inset-bottom)`) work inside shadow DOM

### 4.10 RTL (Right-to-Left) Language Support

The `direction` property IS inherited and crosses the shadow boundary. If the host page has `direction: rtl`, your widget inherits it.

**Defense:**

```css
:host {
  direction: ltr; /* or dynamically set based on widget locale */
}
```

Or support RTL dynamically:

```javascript
const isRTL = widgetConfig.locale && ['ar', 'he', 'fa', 'ur'].includes(widgetConfig.locale);
this.#shadowRoot.querySelector('.widget-container').dir = isRTL ? 'rtl' : 'ltr';
```

---

## 5. CSS Custom Properties Across Shadow Boundary

### 5.1 How CSS Variables Cross Shadow DOM

**CSS custom properties (variables) DO inherit through shadow DOM boundaries.** This is by design -- they are the official theming API for web components.

```css
/* Host page CSS */
:root {
  --brand-color: blue;
}

/* Inside shadow DOM -- this WORKS */
.chat-header {
  background-color: var(--brand-color); /* Resolves to blue */
}
```

`all: initial` does NOT reset custom properties. This is intentional per spec.

### 5.2 Using CSS Variables for Theming

Expose a controlled theming API via namespaced CSS variables:

```css
/* Widget's default theme (inside shadow root) */
:host {
  /* Theming API -- customers can override these */
  --cw-primary: var(--cw-theme-primary, #6366f1);
  --cw-primary-hover: var(--cw-theme-primary-hover, #4f46e5);
  --cw-text: var(--cw-theme-text, #1a1a1a);
  --cw-text-secondary: var(--cw-theme-text-secondary, #6b7280);
  --cw-bg: var(--cw-theme-bg, #ffffff);
  --cw-bg-secondary: var(--cw-theme-bg-secondary, #f3f4f6);
  --cw-border: var(--cw-theme-border, #e5e7eb);
  --cw-radius: var(--cw-theme-radius, 12px);
  --cw-font-family: var(--cw-theme-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  --cw-font-size: var(--cw-theme-font-size, 14px);
  --cw-shadow: var(--cw-theme-shadow, 0 4px 24px rgba(0, 0, 0, 0.12));
}

/* Usage inside shadow DOM */
.chat-header {
  background-color: var(--cw-primary);
  color: white;
  font-family: var(--cw-font-family);
  border-radius: var(--cw-radius) var(--cw-radius) 0 0;
}
```

**Customer theming:**

```css
/* Customer adds this to their site CSS */
:root {
  --cw-theme-primary: #e11d48;
  --cw-theme-radius: 8px;
  --cw-theme-font: 'Poppins', sans-serif;
}
```

Or via JavaScript configuration:

```html
<script>
  window.CodeWeavesChat = {
    theme: {
      primary: '#e11d48',
      radius: '8px',
    }
  };
</script>
```

```javascript
// In widget initialization
const theme = window.CodeWeavesChat?.theme || {};
const host = this.#shadowRoot.host;
if (theme.primary) host.style.setProperty('--cw-theme-primary', theme.primary);
if (theme.radius) host.style.setProperty('--cw-theme-radius', theme.radius);
```

### 5.3 Namespacing to Avoid Conflicts

**Always prefix your CSS variables.** Common prefixes used:

- Intercom: `--intercom-*`
- Chatwoot: Not exposed (iframe-based)
- Generic recommendation: `--cw-*` or `--yourproduct-*`

Without namespacing, if the host page defines `--primary`, `--bg`, `--text` etc., they WILL cascade into your shadow DOM and potentially break your widget.

### 5.4 Performance of CSS Variables

**CSS custom properties have negligible performance impact, even with 50+ variables.**

- Modern browsers optimize CSS custom property resolution
- Variables are resolved once during style computation, not on every frame
- Using `adoptedStyleSheets` (constructable stylesheets) further optimizes performance by sharing parsed stylesheets across shadow roots

```javascript
// Constructable Stylesheets (best performance)
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { --cw-primary: #6366f1; /* ... 50 more variables */ }
  .chat-header { background: var(--cw-primary); }
  /* ... rest of styles */
`);

this.#shadowRoot.adoptedStyleSheets = [sheet];
```

Benefits of `adoptedStyleSheets`:
- Single parsed stylesheet shared across multiple widget instances
- No DOM nodes created for styles
- Can be updated dynamically via `sheet.replaceSync()` or `sheet.replace()` (async)
- Browser de-duplicates the stylesheet parsing

---

## 6. Recommended Architecture for CodeWeaves Chat Widget

### 6.1 Architecture Decision

**Recommended: Shadow DOM launcher + iframe chat window (Hybrid approach)**

This matches what every major production chat widget does, while keeping the launcher lightweight.

### 6.2 Implementation Blueprint

```
document.body
  |
  +-- <div id="cw-chat-root" style="position:fixed; z-index:2147483647; pointer-events:none;">
       |
       +-- #shadow-root (closed)
            |
            +-- <style> ... launcher styles with all:initial reset ... </style>
            +-- <div class="cw-launcher" style="pointer-events:auto;">
            |    +-- <button class="cw-bubble"> ... icon ... </button>
            |    +-- <span class="cw-badge">3</span>
            +-- <div class="cw-chat-frame-container" style="pointer-events:auto;">
                 +-- <iframe src="https://chat.codeweaves.com/widget/{token}"
                            allow="microphone; camera; clipboard-write"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups">
                     </iframe>
```

### 6.3 Loader Script

```javascript
(function() {
  'use strict';

  // Prevent double initialization
  if (window.__cw_chat_loaded) return;
  window.__cw_chat_loaded = true;

  const config = window.CodeWeavesChat || {};
  const WIDGET_URL = 'https://chat.codeweaves.com/widget';

  // Create host element at the very end of body
  const host = document.createElement('div');
  host.id = 'cw-chat-root';
  host.style.cssText = [
    'position: fixed !important',
    'bottom: 0 !important',
    'right: 0 !important',
    'z-index: 2147483647 !important',
    'width: 0 !important',
    'height: 0 !important',
    'overflow: visible !important',
    'pointer-events: none !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: none !important',
    'background: transparent !important',
  ].join('; ');

  // Inject fonts into light DOM
  const fontStyle = document.createElement('style');
  fontStyle.textContent = `
    @font-face {
      font-family: 'CW-Inter';
      src: url('${WIDGET_URL}/fonts/inter.woff2') format('woff2');
      font-weight: 100 900;
      font-display: swap;
    }
  `;
  document.head.appendChild(fontStyle);

  // Attach closed shadow root
  const shadow = host.attachShadow({ mode: 'closed' });

  // Build widget inside shadow root
  // ... (launcher button, iframe for chat window)

  // Mount
  document.body.appendChild(host);

  // Enforce z-index with MutationObserver
  const enforceStyles = () => {
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('position', 'fixed', 'important');
  };
  const observer = new MutationObserver(enforceStyles);
  observer.observe(host, { attributes: true, attributeFilter: ['style'] });

  // Expose public API
  window.CodeWeavesChat = {
    ...config,
    open: () => { /* ... */ },
    close: () => { /* ... */ },
    destroy: () => {
      observer.disconnect();
      host.remove();
      fontStyle.remove();
      delete window.__cw_chat_loaded;
    }
  };
})();
```

### 6.4 Key Production Considerations

1. **Fail silently** -- wrap everything in try/catch. Your widget is a guest on someone else's site. Never break the host page.

2. **Lazy load the iframe** -- only load the full chat iframe when the user clicks the launcher bubble. This dramatically reduces initial page load impact.

3. **Bundle size target** -- the launcher script (before iframe loads) should be under 15KB gzipped.

4. **CSP compatibility** -- customers may need to add your domain to their `frame-src` CSP directive. Document this requirement.

5. **Third-party cookie deprecation** -- if your iframe needs cookies for auth, consider using `postMessage` to pass auth tokens from the host page instead.

6. **Multiple instances** -- guard against double-loading with a global flag.

7. **Cleanup** -- always provide a `destroy()` method that removes all DOM elements, event listeners, and MutationObservers.

8. **Performance monitoring** -- measure your widget's impact on the host page's Core Web Vitals (LCP, FID/INP, CLS). The launcher should contribute zero CLS.

---

## Sources

### Shadow DOM & CSS Isolation
- [MDN: Using Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)
- [Shadow DOM "the right way" in 2024](https://dev.to/nitipit/shadow-dom-the-right-way-in-2024-574i)
- [Courier: How to Use Shadow DOM to Isolate Styles](https://www.courier.com/blog/how-to-use-the-shadow-dom-to-isolate-styles-on-a-dom-that-isnt-yours)
- [Open WC: Styles Piercing Shadow DOM](https://open-wc.org/guides/knowledge/styling/styles-piercing-shadow-dom/)
- [CSS Resets in Shadow DOM](https://blog.jiayihu.net/css-resets-in-shadow-dom/)
- [Shadow DOM Guide: Security & Use Cases 2025](https://cybersguards.com/shadow-dom/)

### Font-Face Issue
- [Rob Dodson: @font-face doesn't work in Shadow DOM](https://robdodson.me/posts/at-font-face-doesnt-work-in-shadow-dom/)
- [Load external font with web component](https://dev.to/akdevcraft/use-font-in-web-component-51a4)
- [use-font Web Component](https://github.com/JRJurman/use-font)

### CSS Variables & Theming
- [Public CSS Custom Properties in Shadow DOM](https://michaelwarren.dev/blog/css-variables-in-wc/)
- [Go Make Things: Styling Shadow DOM with CSS Variables](https://gomakethings.com/styling-the-shadow-dom-with-css-variables-in-web-components/)
- [Shadow DOM Styling Options - Complete Guide](https://shadow-style.github.io/)

### Z-Index & Stacking Contexts
- [WICG: Shadow root z-index stacking context issue #672](https://github.com/WICG/webcomponents/issues/672)
- [Smashing Magazine: Managing Z-Index in Component-Based Apps](https://www.smashingmagazine.com/2019/04/z-index-component-based-web-application/)
- [Josh Comeau: What the Heck, z-index??](https://www.joshwcomeau.com/css/stacking-contexts/)
- [Tawk.to: Customizing z-index](https://help.tawk.to/article/customizing-your-z-index-with-the-javascript-api)
- [Chatwoot z-index issue #8957](https://github.com/chatwoot/chatwoot/issues/8957)

### Accessibility
- [Alice Boxhall: How Shadow DOM and Accessibility Are in Conflict](https://alice.pages.igalia.com/blog/how-shadow-dom-and-accessibility-are-in-conflict/)
- [Marcy Sutton: Accessibility and the Shadow DOM](https://marcysutton.com/accessibility-and-the-shadow-dom/)
- [Nolan Lawson: Shadow DOM and Accessibility -- The Trouble with ARIA](https://nolanlawson.com/2022/11/28/shadow-dom-and-accessibility-the-trouble-with-aria/)
- [Nolan Lawson: Dialogs and Shadow DOM Accessibility](https://nolanlawson.com/2022/06/14/dialogs-and-shadow-dom-can-we-make-it-accessible/)
- [Cory Rylan: Accessibility with ID Referencing and Shadow DOM](https://coryrylan.com/blog/accessibility-with-id-referencing-and-shadow-dom)

### Focus Management
- [Nolan Lawson: Managing Focus in the Shadow DOM](https://nolanlawson.com/2021/02/13/managing-focus-in-the-shadow-dom/)
- [MDN: ShadowRoot delegatesFocus](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/delegatesFocus)
- [Sam Thorogood: Focus Inside Shadow DOM](https://medium.com/dev-channel/focus-inside-shadow-dom-78e8a575b73)
- [This Dot Labs: Form Autofill, LitElement and Shadow DOM](https://www.thisdot.co/blog/a-tale-of-form-autofill-litelement-and-the-shadow-dom)

### Events
- [javascript.info: Shadow DOM and Events](https://javascript.info/shadow-dom-events)
- [Shadow DOM Event Propagation Guide](https://pm.dartus.fr/posts/2021/shadow-dom-and-event-propagation/)
- [MDN: Event.composed](https://developer.mozilla.org/en-US/docs/Web/API/Event/composed)

### Production Widget Implementations
- [Chatwoot IFrameHelper.js Source](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/sdk/IFrameHelper.js)
- [Crisp iFrame Widget Docs](https://docs.crisp.chat/guides/plugins/widgets/iframe-widget/)
- [CompanyCam: Build Embeddable Widget with Preact and Shadow DOM](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)
- [MakerKit: Building Embeddable React Widgets](https://makerkit.dev/blog/tutorials/embeddable-widgets-react)
- [Shadow DOM vs. iFrame Comparison](https://www.factorial.io/en/blog/building-towards-reusable-modular-web-iframes-and-web-components)
- [Viget: Embeddable Web Applications with Shadow DOM](https://www.viget.com/articles/embedable-web-applications-with-shadow-dom)

### Performance
- [MDN: adoptedStyleSheets](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets)
- [Why ShadowDOM Matters More Than You Think](https://dev.to/alanwest/why-shadowdom-matters-more-than-you-think-3cmm)
