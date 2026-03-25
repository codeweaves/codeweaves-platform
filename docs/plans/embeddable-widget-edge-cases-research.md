# Embeddable Chat Widget: Edge Cases, Mobile, Accessibility & Battle-Tested Patterns

> Research document for the CodeWeaves embeddable chat widget.
> This widget will be deployed on THOUSANDS of customer websites — every edge case matters.

---

## Table of Contents

1. [Mobile-Specific Challenges](#1-mobile-specific-challenges)
2. [Accessibility with Shadow DOM](#2-accessibility-with-shadow-dom)
3. [Performance Edge Cases](#3-performance-edge-cases)
4. [Host Page Conflicts & Battle Testing](#4-host-page-conflicts--battle-testing)
5. [Script Tag Loading Patterns](#5-script-tag-loading-patterns)
6. [Cross-Browser Compatibility (2026)](#6-cross-browser-compatibility-2026)
7. [Content Security Policy (CSP)](#7-content-security-policy-csp)
8. [Real-World Testing Strategies](#8-real-world-testing-strategies)

---

## 1. Mobile-Specific Challenges

### 1.1 iOS Safari `position: fixed` + Virtual Keyboard

**The Problem:** iOS Safari does NOT resize the Layout Viewport when the virtual keyboard opens. Instead, it offsets the visual viewport upward. Elements with `position: fixed; bottom: 0` become hidden behind the keyboard or behave like `position: static`.

**The Solution — VisualViewport API:**

```typescript
// Battle-tested pattern for iOS Safari keyboard handling
function setupKeyboardHandler(widgetEl: HTMLElement) {
  if (!window.visualViewport) return;

  const onViewportResize = () => {
    const vv = window.visualViewport!;
    // Calculate offset from bottom of layout viewport to bottom of visual viewport
    const offsetBottom = window.innerHeight - (vv.offsetTop + vv.height);
    widgetEl.style.transform = `translateY(-${offsetBottom}px)`;
  };

  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportResize);

  // Return cleanup function
  return () => {
    window.visualViewport?.removeEventListener('resize', onViewportResize);
    window.visualViewport?.removeEventListener('scroll', onViewportResize);
  };
}
```

**GOTCHA (iOS 26):** There are reported issues where `visualViewport.height` consistently remains smaller than `window.innerHeight` after keyboard dismissal. Test thoroughly on latest iOS.

**Alternative — `interactive-widget` meta tag:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content">
```
- `resizes-visual` — Resize only Visual Viewport (default on most browsers)
- `resizes-content` — Resize both Visual and Layout Viewport
- `overlays-content` — Do not resize any viewport

**Support:** Chrome 108+, Firefox 132+. **NOT supported in Safari/WebKit** as of March 2026. Since our widget cannot control the host page's meta tags, we MUST use the VisualViewport API approach.

### 1.2 `100vh` vs `100dvh` — Which to Use

| Unit | Behavior | Use Case |
|------|----------|----------|
| `100vh` | Fixed to initial viewport, does NOT change with keyboard/URL bar | Avoid for mobile |
| `100svh` | Smallest possible viewport (URL bar visible) | Safe minimum height |
| `100lvh` | Largest possible viewport (URL bar hidden) | Max possible height |
| `100dvh` | Dynamic — changes in real-time as browser chrome appears/disappears | Chat window height |

**Recommendation:** Use `100dvh` with `100vh` fallback:

```css
.chat-window {
  height: 100vh; /* fallback */
  height: 100dvh;
}
```

**GOTCHA:** `dvh` triggers layout recalculation every time the toolbar animates, which can cause visible reflow and janky animations during scroll. For the chat window specifically, use `100svh` as the base and adjust with VisualViewport API only when keyboard is active.

**Browser support:** `dvh` has Baseline Widely Available status since June 2025. ~95% global coverage. Remaining gap is older Samsung Internet and UC Browser.

### 1.3 Safe Area Insets (Notch Devices)

Devices with notches, rounded corners, and home indicators require safe area padding.

**Requirement:** The host page must have `viewport-fit=cover` in its meta viewport tag for `env()` values to be non-zero. Since we cannot guarantee this on customer sites, use defensive defaults:

```css
.widget-trigger {
  bottom: max(16px, env(safe-area-inset-bottom, 16px));
  right: max(16px, env(safe-area-inset-right, 16px));
}

.chat-window {
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
}
```

**Browser support for `env(safe-area-inset-*)`:** 96.78% global coverage.

### 1.4 Mobile Scroll Locking When Chat is Open

**The Problem:** When the chat window is open on mobile, scrolling inside the chat can "chain" to the body, scrolling the page behind the modal.

**The Nuclear Option (Most Reliable for iOS Safari):**

```typescript
let scrollPosition = 0;

function lockScroll() {
  scrollPosition = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollPosition}px`;
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  window.scrollTo(0, scrollPosition);
}
```

**Why `overflow: hidden` alone is not enough:** On iOS Safari 15+, `overflow: hidden` on body does NOT prevent touch-based scrolling. The fixed position approach is the only reliable cross-platform solution.

**Additional CSS for the chat window's scrollable area:**

```css
.chat-messages {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain; /* Prevents scroll chaining */
  touch-action: pan-y; /* Allow vertical scroll only */
}
```

**`overscroll-behavior: contain`** is the modern solution — it prevents scroll chaining without needing JavaScript. Works in Chrome, Firefox, Safari 16+.

### 1.5 How Intercom/Drift Handle Mobile

- Intercom does **NOT** go fullscreen on mobile. It opens a near-fullscreen overlay that sits within the viewport with a small margin at top.
- Neither Intercom nor Drift has native fullscreen mobile chat as a standard feature.
- Common pattern: On mobile (< 768px), the chat window expands to fill most of the screen, with a visible "X" close button and the page body scroll-locked behind it.

**Our recommended approach:**

```css
/* Desktop */
.chat-window {
  width: 380px;
  height: 600px;
  max-height: 80vh;
  position: fixed;
  bottom: 80px;
  right: 16px;
  border-radius: 12px;
}

/* Mobile — near-fullscreen overlay */
@media (max-width: 640px) {
  .chat-window {
    width: 100%;
    height: 100svh; /* Use svh, not dvh, to avoid jank */
    max-height: none;
    bottom: 0;
    right: 0;
    left: 0;
    border-radius: 0;
  }
}
```

### 1.6 Touch Event Handling

- Always use `passive: true` for touch/scroll event listeners where you don't call `preventDefault()` — otherwise iOS Safari shows performance warnings and may delay rendering.
- For scroll-locking touch handlers that DO call `preventDefault()`, explicitly set `{ passive: false }`.

```typescript
// Inside shadow DOM chat container
chatMessages.addEventListener('touchmove', (e) => {
  // Allow scrolling within the chat messages area
  e.stopPropagation();
}, { passive: true });

// On the overlay/backdrop — prevent scroll
overlay.addEventListener('touchmove', (e) => {
  e.preventDefault();
}, { passive: false });
```

### 1.7 Pinch-to-Zoom Prevention Inside Widget

```css
.chat-window {
  touch-action: pan-x pan-y; /* Allow panning, disable pinch-zoom */
}
```

Do NOT use `touch-action: none` on the whole widget — that breaks scrolling. Only disable pinch-zoom.

### 1.8 iOS Rubber-Band Scrolling Inside Shadow DOM

iOS Safari's elastic "bounce" scrolling works inside Shadow DOM, but can cause visual artifacts when the user scrolls past the bounds of the chat message list.

```css
.chat-messages {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
```

`overscroll-behavior-y: contain` prevents the bounce from propagating to the parent but does NOT eliminate the internal bounce effect (which is actually fine UX on iOS).

---

## 2. Accessibility with Shadow DOM

### 2.1 Screen Reader Behavior with Shadow DOM

**Good news:** Screen readers (NVDA, JAWS, VoiceOver) hook into the browser's accessibility tree, which is the **flattened/composed** tree. Shadow DOM boundaries are transparent to assistive technology. Content inside Shadow DOM IS accessible to screen readers.

**GOTCHA — ARIA IDREFs do NOT cross Shadow DOM boundaries.** This means:
- `aria-labelledby="some-id"` will NOT work if the referenced ID is outside the shadow root.
- `aria-describedby`, `aria-controls`, `aria-owns` — same limitation.
- **Solution:** Keep all ARIA IDREF relationships within the same shadow root.

### 2.2 Focus Trapping Inside Chat Window

When the chat window is open, focus must be trapped inside it (like a modal dialog). This is critical but tricky with Shadow DOM because it creates a separate focus scope.

```typescript
function createFocusTrap(shadowRoot: ShadowRoot) {
  const FOCUSABLE_SELECTOR =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function getFocusableElements(): HTMLElement[] {
    return Array.from(shadowRoot.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null) as HTMLElement[];
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Get active element — need to check shadowRoot.activeElement
    const activeEl = shadowRoot.activeElement;

    if (e.shiftKey) {
      // Shift+Tab: if on first element, wrap to last
      if (activeEl === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if on last element, wrap to first
      if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Activate
  shadowRoot.addEventListener('keydown', handleKeyDown);
  const focusable = getFocusableElements();
  if (focusable.length > 0) focusable[0].focus();

  // Deactivate — returns cleanup function
  return () => {
    shadowRoot.removeEventListener('keydown', handleKeyDown);
  };
}
```

**CRITICAL:** Use `shadowRoot.activeElement` (not `document.activeElement`) to detect focus within shadow DOM. `document.activeElement` will return the shadow host element, not the actually focused element inside the shadow.

### 2.3 Focus Restoration on Close

```typescript
let previouslyFocusedElement: HTMLElement | null = null;

function openChat() {
  previouslyFocusedElement = document.activeElement as HTMLElement;
  // ... open chat, activate focus trap
}

function closeChat() {
  // ... deactivate focus trap
  previouslyFocusedElement?.focus();
  previouslyFocusedElement = null;
}
```

### 2.4 Keyboard Navigation

| Key | Action |
|-----|--------|
| `Enter` / `Space` | Open chat (on trigger button) |
| `Escape` | Close chat window |
| `Tab` | Move to next focusable element (trapped) |
| `Shift+Tab` | Move to previous focusable element (trapped) |
| `Enter` | Send message (in input field) |

```typescript
// Escape to close — on the shadow root
shadowRoot.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeChat();
  }
});
```

### 2.5 `aria-live` Regions for New Messages

Screen readers need to announce new messages as they arrive. `aria-live` works inside Shadow DOM.

```html
<!-- Inside shadow DOM -->
<div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
  <!-- Messages are appended here -->
</div>
```

- Use `aria-live="polite"` — waits until the user is idle before announcing (appropriate for chat messages).
- Use `aria-live="assertive"` only for critical alerts (e.g., connection lost).
- The live region MUST exist in the DOM before content is added (don't create it dynamically on first message).
- Use `role="log"` on the message container — semantically correct for chat history.

**GOTCHA:** If you use virtualized scrolling (only rendering visible messages), screen readers may miss messages. For accessibility, maintain a separate hidden `aria-live` region that receives all new message text, even if the visible list is virtualized.

### 2.6 Chat Window Role — `dialog` vs `complementary`

**Use `role="dialog"` with `aria-modal="true"`** when the chat is open and focus-trapped:

```html
<div role="dialog" aria-modal="true" aria-label="Customer support chat">
  <!-- chat content -->
</div>
```

- `role="dialog"` + `aria-modal="true"` tells screen readers this is a modal that traps focus.
- When the chat is minimized/closed, remove the dialog from the DOM or set `aria-hidden="true"`.

**Alternative for "always visible" mode (no focus trap):** Use `role="complementary"` with `aria-label="Chat widget"`. This marks it as a secondary content region, like a sidebar.

### 2.7 Trigger Button Accessibility

```html
<button
  aria-label="Open customer support chat"
  aria-haspopup="dialog"
  aria-expanded="false"  <!-- Toggle to "true" when open -->
>
  <svg aria-hidden="true"><!-- chat icon --></svg>
</button>
```

- `aria-haspopup="dialog"` tells screen readers that this button opens a dialog.
- `aria-expanded` communicates current state.
- Icon must have `aria-hidden="true"` since the button has an `aria-label`.

### 2.8 Color Contrast (WCAG 2.1 AA)

- **Minimum contrast ratio:** 4.5:1 for normal text, 3:1 for large text (18pt or 14pt bold).
- **Custom themes risk:** When customers can customize widget colors, we MUST validate contrast ratios at configuration time and warn/block insufficient contrast.
- Consider providing a "high contrast" mode toggle inside the widget.

```typescript
// Contrast ratio checker — run at theme configuration time
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateThemeContrast(theme: WidgetTheme): string[] {
  const warnings: string[] = [];
  const textOnPrimary = getContrastRatio(theme.primaryColor, theme.textColor);
  if (textOnPrimary < 4.5) {
    warnings.push(`Text on primary background has insufficient contrast (${textOnPrimary.toFixed(1)}:1, needs 4.5:1)`);
  }
  return warnings;
}
```

### 2.9 Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  .chat-window,
  .widget-trigger,
  .message {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
```

Also check in JavaScript for animation triggers:

```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function openChatWindow() {
  if (prefersReducedMotion) {
    chatWindow.style.display = 'block'; // Instant show
  } else {
    chatWindow.classList.add('animate-slide-up'); // Animated
  }
}
```

---

## 3. Performance Edge Cases

### 3.1 Widget on Heavy Pages (100+ DOM elements, heavy JS)

- **Shadow DOM is our friend here** — the widget's DOM is isolated, so the host page's layout thrashing does not directly affect widget rendering.
- Keep the widget's DOM tree small (< 100 nodes when chat is closed, < 500 when open).
- Use `contain: layout style` on the widget host element to prevent layout recalculations from propagating.

```css
:host {
  contain: layout style;
  position: fixed;
  z-index: 2147483647; /* Max z-index */
}
```

### 3.2 Memory Leaks from Long Chat Sessions

Common leak sources and mitigations:

| Leak Source | Mitigation |
|-------------|------------|
| Event listeners not cleaned up | Store all listener references; remove on destroy |
| WebSocket/SSE connections | AbortController pattern; close on destroy |
| Accumulated message DOM nodes | Virtualize message list; limit to ~200 visible nodes |
| Stale closures holding old state | Use refs instead of closures for mutable state |
| Timer/interval not cleared | Track all timer IDs; clearInterval/clearTimeout on destroy |
| Large message history in memory | Cap in-memory messages (e.g., 500); paginate older from server |

**Message virtualization pattern:**

```typescript
// Only render messages in the visible viewport + buffer
const BUFFER_SIZE = 20;
const MESSAGE_HEIGHT_ESTIMATE = 60; // px

function getVisibleRange(scrollTop: number, containerHeight: number, totalMessages: number) {
  const startIdx = Math.max(0, Math.floor(scrollTop / MESSAGE_HEIGHT_ESTIMATE) - BUFFER_SIZE);
  const endIdx = Math.min(
    totalMessages,
    Math.ceil((scrollTop + containerHeight) / MESSAGE_HEIGHT_ESTIMATE) + BUFFER_SIZE
  );
  return { startIdx, endIdx };
}
```

### 3.3 SPA Navigation / Route Changes

**The Problem:** SPAs don't trigger full page loads. If the widget is attached to a DOM element that gets replaced during navigation, the widget is destroyed without cleanup.

**Solution — MutationObserver for self-healing:**

```typescript
class WidgetManager {
  private observer: MutationObserver | null = null;
  private hostElement: HTMLElement | null = null;

  init() {
    this.mount();
    this.watchForRemoval();
  }

  private mount() {
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'codeweaves-widget-host';
    document.body.appendChild(this.hostElement);
    // Attach shadow DOM and render widget...
  }

  private watchForRemoval() {
    // If something removes our element, re-mount
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (removed === this.hostElement || (removed as Element).contains?.(this.hostElement!)) {
            // Our host was removed — re-mount
            console.warn('[CodeWeaves] Widget host removed, re-mounting...');
            this.mount();
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  destroy() {
    this.observer?.disconnect();
    this.hostElement?.remove();
    // Clean up all listeners, connections, timers...
  }
}
```

**Also handle `popstate` / `hashchange`:**

```typescript
// Detect SPA navigation
window.addEventListener('popstate', () => {
  // Widget persists — no action needed if mounted to body
  // But re-check configuration (e.g., should widget be hidden on certain pages?)
});
```

### 3.4 Cleanup/Destroy Pattern

Every embeddable widget MUST expose a clean destroy method:

```typescript
interface CodeWeavesWidget {
  init(config: WidgetConfig): void;
  destroy(): void;
  open(): void;
  close(): void;
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
}

// Implementation
class Widget implements CodeWeavesWidget {
  private cleanupFns: Array<() => void> = [];

  init(config: WidgetConfig) {
    // ... setup
    // Track every side effect for cleanup
    const keyboardCleanup = setupKeyboardHandler(this.element);
    this.cleanupFns.push(keyboardCleanup);

    const resizeHandler = () => { /* ... */ };
    window.addEventListener('resize', resizeHandler);
    this.cleanupFns.push(() => window.removeEventListener('resize', resizeHandler));

    // WebSocket
    const ws = new WebSocket(config.wsUrl);
    this.cleanupFns.push(() => ws.close());
  }

  destroy() {
    // Run all cleanup functions in reverse order
    while (this.cleanupFns.length) {
      const fn = this.cleanupFns.pop()!;
      try { fn(); } catch (e) { console.error('[CodeWeaves] Cleanup error:', e); }
    }
    // Remove DOM
    this.shadowHost?.remove();
  }
}
```

### 3.5 Lazy Loading — Only Load Full Widget on Click

**Recommended two-phase loading pattern:**

```html
<!-- Phase 1: Tiny loader script (~2KB gzipped) -->
<script async src="https://cdn.codeweaves.com/widget/loader.js"
  data-widget-id="abc123"></script>
```

```typescript
// loader.js — Phase 1 (~2KB)
(function() {
  // Prevent double-load
  if (window.__codeweaves_loaded) return;
  window.__codeweaves_loaded = true;

  // Create trigger button immediately (lightweight)
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .trigger {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--cw-primary, #6366f1);
        border: none;
        cursor: pointer;
        z-index: 2147483647;
        /* ... minimal styles */
      }
    </style>
    <button class="trigger" aria-label="Open chat">
      <svg><!-- chat icon inline SVG --></svg>
    </button>
  `;
  document.body.appendChild(host);

  // Phase 2: Load full widget only on interaction
  const trigger = shadow.querySelector('.trigger')!;
  trigger.addEventListener('click', async () => {
    trigger.innerHTML = '<div class="spinner"></div>'; // Loading state
    const module = await import('https://cdn.codeweaves.com/widget/widget.js');
    module.init({ widgetId: host.dataset.widgetId, shadowRoot: shadow });
  }, { once: true });
})();
```

**Benefits:**
- Initial page impact: ~2KB gzipped (just the trigger button)
- Full widget JS (~40-80KB gzipped) loads only when needed
- No impact on host page's Core Web Vitals

### 3.6 Multiple Widgets on Same Page (Prevent It)

```typescript
// In the loader
(function() {
  if (window.__codeweaves_loaded) {
    console.warn('[CodeWeaves] Widget already loaded. Ignoring duplicate script tag.');
    return;
  }
  window.__codeweaves_loaded = true;
  // ...
})();
```

Use a global flag. Do NOT try to support multiple widget instances — it creates UX confusion and z-index conflicts.

---

## 4. Host Page Conflicts & Battle Testing

### 4.1 Shadow DOM CSS Isolation — What IS and ISN'T Protected

**Shadow DOM DOES protect against:**
- Host page class-based styles (`.button { }`, `.modal { }`)
- Host page ID-based styles (`#chat { }`)
- Tag-based styles with specificity (`div.container > p { }`)
- CSS resets (normalize.css, reset.css, sanitize.css)
- `* { box-sizing: border-box }` — does NOT leak into shadow DOM
- `!important` on wildcard selectors — does NOT leak in

**Shadow DOM does NOT protect against:**
- **Inherited CSS properties** — these DO cross the shadow boundary:
  - `font-family`, `font-size`, `color`, `line-height`
  - `direction`, `text-align`
  - `visibility`, `cursor`
  - `letter-spacing`, `word-spacing`
- **CSS custom properties (variables)** — these inherit into shadow DOM

**Defense — Reset inherited properties at the shadow root:**

```css
:host {
  /* Reset ALL inheritable properties */
  all: initial;

  /* Then set our own defaults */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  direction: ltr;
  text-align: left;
  letter-spacing: normal;
  word-spacing: normal;
  -webkit-text-size-adjust: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

**`all: initial`** is the nuclear option — it resets ALL inherited properties. This is recommended for embeddable widgets because you cannot predict the host page's styles.

### 4.2 CSS Frameworks — Specific Conflicts

| Framework | Risk | Shadow DOM Protection |
|-----------|------|----------------------|
| Bootstrap | Global resets, `* { box-sizing }` | Fully protected |
| Tailwind CSS | Preflight (CSS reset), utility classes | Fully protected |
| Material UI | Emotion/JSS injects `<style>` in `<head>` | Fully protected |
| Foundation | Global resets, aggressive base styles | Fully protected |
| Bulma | Global element styles (`input`, `button`) | Fully protected |

**The only risk is inherited properties**, which `all: initial` on `:host` handles.

### 4.3 WordPress Themes & Plugins — Known Conflicts

- **Elementor:** Adds aggressive z-index values (up to 10000). Use `z-index: 2147483647` (max 32-bit integer).
- **WP Super Cache / W3 Total Cache:** May combine and minify our script, breaking it. Customers need to exclude our script from minification.
- **Jetpack:** Has its own chat widget (Happychat). No technical conflict if both use Shadow DOM, but UX overlap.
- **WooCommerce:** Heavy DOM pages (product listings). Our lazy-loading approach is critical here.
- **jQuery UI:** Uses `z-index` extensively for dialogs/overlays. Our max z-index handles this.

**Documentation we should provide to WordPress customers:**
1. Exclude `cdn.codeweaves.com` from caching/minification plugins
2. If using a CSP plugin, add our domains to allowed sources

### 4.4 Shopify Themes — Known Conflicts

- **Shopify themes use heavy z-index on navigation and cart drawers.** Our max z-index handles this.
- **Shopify's Online Store 2.0 themes** use Web Components / custom elements. No conflict with our Shadow DOM.
- **Shopify checkout pages** are restricted — widgets cannot be added to checkout (Shopify limitation, not ours).
- **Shopify CDN caching:** Customers should add our script via the `theme.liquid` file, not as a Shopify asset.

### 4.5 Sites with `overflow: hidden` on Body

Some sites set `overflow: hidden` on `<body>` for their own modals/overlays. Our widget is `position: fixed` and lives at the end of `<body>`, so this does NOT affect us. However:

- When WE lock scroll (chat open on mobile), we need to check if body already has `overflow: hidden` and not restore it incorrectly:

```typescript
let originalBodyOverflow: string | null = null;

function lockScroll() {
  originalBodyOverflow = document.body.style.overflow; // Might already be 'hidden'
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  document.body.style.overflow = originalBodyOverflow ?? '';
  originalBodyOverflow = null;
}
```

### 4.6 jQuery UI and Overlay Systems

jQuery UI dialogs use z-index up to ~1000 by default. Bootstrap modals use 1050-1070. Our `z-index: 2147483647` ensures we're always on top.

**BUT:** Some overlay systems use `pointer-events: none` on the entire page. If a host page does this, our widget becomes unclickable. This is an extreme edge case — document it as a known limitation.

---

## 5. Script Tag Loading Patterns

### 5.1 `async` vs `defer` vs Neither

| Attribute | Download | Execute | Use When |
|-----------|----------|---------|----------|
| (none) | Blocks parsing | Immediately | Never — terrible for perf |
| `async` | Parallel | ASAP when ready (order not guaranteed) | Independent scripts |
| `defer` | Parallel | After DOM parsing, before DOMContentLoaded | Scripts that need DOM |

**Recommendation: Use `async`**

Our widget loader is self-contained and does not depend on DOM order. `async` ensures minimal impact on host page load time.

```html
<script async src="https://cdn.codeweaves.com/widget/loader.js"
  data-widget-id="abc123"></script>
```

### 5.2 When to Initialize

```typescript
// Handle all possible loading scenarios
(function() {
  function init() {
    // Widget initialization code
  }

  if (document.readyState === 'loading') {
    // DOM not ready yet — wait
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already ready (script loaded late, or async after DOMContentLoaded)
    init();
  }
})();
```

**Do NOT wait for `window.onload`** — that waits for all images/iframes, which is far too late.

### 5.3 Dynamic Script Loading

If customers load our script dynamically:

```javascript
// This should work fine
const script = document.createElement('script');
script.src = 'https://cdn.codeweaves.com/widget/loader.js';
script.async = true;
script.dataset.widgetId = 'abc123';
document.head.appendChild(script);
```

Our script reads `data-widget-id` from the `<script>` tag. For dynamic loading, we need to support both:

```typescript
// Method 1: Read from script tag
const currentScript = document.currentScript as HTMLScriptElement;
const widgetId = currentScript?.dataset?.widgetId;

// Method 2: Global config (fallback for dynamic loading)
const globalConfig = (window as any).__codeweaves_config;
const config = widgetId ? { widgetId } : globalConfig;
```

### 5.4 Multiple Script Tags (User Error)

```typescript
// Singleton guard — FIRST LINE of the loader
if ((window as any).__codeweaves_loaded) {
  console.warn('[CodeWeaves] Widget script loaded multiple times. Ignoring duplicate.');
  return;
}
(window as any).__codeweaves_loaded = true;
```

### 5.5 Slow Networks — Progressive Loading

```typescript
// Show trigger button immediately with inline styles (no external CSS needed)
// Then load full widget on interaction
// If full widget fails to load, show error state:

trigger.addEventListener('click', async () => {
  trigger.innerHTML = '<div class="spinner">...</div>';
  try {
    const module = await import(widgetUrl);
    module.init(config);
  } catch (error) {
    // Show retry button
    trigger.innerHTML = `
      <button onclick="this.parentElement.click()">
        Could not load chat. Tap to retry.
      </button>
    `;
  }
});
```

### 5.6 Subresource Integrity (SRI) for CDN Scripts

SRI prevents tampered CDN scripts from executing:

```html
<script async
  src="https://cdn.codeweaves.com/widget/loader.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8w"
  crossorigin="anonymous"
  data-widget-id="abc123">
</script>
```

**GOTCHA for SRI:** Every time we update the widget script, the hash changes. This means:
- Customers with hardcoded SRI hashes will get blocked on updates.
- **Recommendation:** Do NOT use SRI for the loader script (it changes with updates). Instead, use SRI for immutable versioned assets loaded by the widget internally.
- Use a versioned URL pattern: `cdn.codeweaves.com/widget/v2/loader.js` for breaking changes.

**CDN Requirements for SRI:**
- CDN must set `Access-Control-Allow-Origin: *` header
- Must serve over HTTPS

---

## 6. Cross-Browser Compatibility (2026)

### 6.1 Shadow DOM Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Shadow DOM v1 | 53+ | 63+ | 10.1+ | 79+ |
| Open shadow root | Yes | Yes | Yes | Yes |
| Closed shadow root | Yes | Yes | Yes | Yes |
| `adoptedStyleSheets` | 73+ | 101+ | 16.4+ | 79+ |

**Global support in 2026: ~97%**. No polyfills needed.

### 6.2 Constructable Stylesheets

```typescript
// Preferred method — single stylesheet object, no <style> tag needed
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { all: initial; }
  .chat-window { /* ... */ }
`);
shadowRoot.adoptedStyleSheets = [sheet];
```

**Support:** Chrome 73+, Firefox 101+, Safari 16.4+, Edge 79+. ~95% global coverage in 2026.

**Fallback for older browsers:**

```typescript
function applyStyles(shadowRoot: ShadowRoot, css: string) {
  if ('adoptedStyleSheets' in Document.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [sheet];
  } else {
    // Fallback: inject <style> tag
    const style = document.createElement('style');
    style.textContent = css;
    shadowRoot.appendChild(style);
  }
}
```

### 6.3 CSS Container Queries

Supported in Chrome 105+, Firefox 110+, Safari 16+, Edge 105+. ~93% global coverage.

**Excellent for the widget:** Instead of media queries (which respond to the page viewport), container queries respond to the widget's own size:

```css
.chat-window {
  container-type: inline-size;
}

@container (max-width: 350px) {
  .message-avatar { display: none; }
  .message-text { font-size: 13px; }
}
```

**Note:** The container queries polyfill does NOT support Shadow DOM. But native support is broad enough in 2026 to not need the polyfill.

### 6.4 IE11

**No.** IE11 was officially retired by Microsoft in June 2022. Global usage in 2026 is < 0.1%. Do not support it. Our `es2020` build target is correct.

### 6.5 Remaining Polyfill Needs

In 2026, for our target set of features, **no polyfills are needed**:
- Shadow DOM v1: 97%+
- Constructable Stylesheets: 95%+ (with `<style>` fallback)
- Container Queries: 93%+
- `dvh` units: 95%+
- `env(safe-area-inset-*)`: 96%+
- VisualViewport API: 95%+

---

## 7. Content Security Policy (CSP)

This is the **#1 deployment blocker** for embeddable widgets on enterprise sites. Many enterprise customers have strict CSP headers.

### 7.1 Inline `<style>` Inside Shadow DOM — CSP Blocks It

**YES, CSP `style-src` directive DOES apply inside Shadow DOM.** If the host page has:

```
Content-Security-Policy: style-src 'self'
```

Then `<style>` tags inside Shadow DOM will be blocked. This is a critical issue.

### 7.2 Constructable Stylesheets Bypass CSP

**Constructable Stylesheets (`adoptedStyleSheets`) are NOT blocked by CSP `style-src` restrictions.** This is because they are created via JavaScript API, not via inline `<style>` elements.

```typescript
// This works even with strict CSP that blocks inline styles
const sheet = new CSSStyleSheet();
sheet.replaceSync(`.chat-window { background: white; }`);
shadowRoot.adoptedStyleSheets = [sheet];
```

**This is a major reason to prefer Constructable Stylesheets over `<style>` tags in Shadow DOM.**

### 7.3 Nonce-Based CSP Fallback

For the `<style>` tag fallback (older browsers), we need to support nonces:

```typescript
function applyStyles(shadowRoot: ShadowRoot, css: string, nonce?: string) {
  if ('adoptedStyleSheets' in Document.prototype) {
    // Preferred: CSP-safe, no nonce needed
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [sheet];
  } else {
    // Fallback: need nonce for strict CSP sites
    const style = document.createElement('style');
    if (nonce) style.nonce = nonce;
    style.textContent = css;
    shadowRoot.appendChild(style);
  }
}
```

Customers with strict CSP must either:
1. Use a browser supporting Constructable Stylesheets (95%+ in 2026), OR
2. Provide a nonce via the widget config:

```html
<script async src="https://cdn.codeweaves.com/widget/loader.js"
  data-widget-id="abc123"
  data-csp-nonce="abc123xyz">
</script>
```

### 7.4 `connect-src` for API Calls

Customers MUST add our API domain to their CSP `connect-src`:

```
Content-Security-Policy: connect-src 'self' https://api.codeweaves.com wss://ws.codeweaves.com
```

**Documentation we must provide:**

```
# Required CSP Directives for CodeWeaves Chat Widget

script-src: https://cdn.codeweaves.com
connect-src: https://api.codeweaves.com wss://ws.codeweaves.com
style-src: (not needed if browser supports Constructable Stylesheets)
img-src: https://cdn.codeweaves.com (for avatars/images)
font-src: https://cdn.codeweaves.com (if loading custom fonts)
```

### 7.5 `script-src` and Dynamic Imports

If we use dynamic `import()` for lazy loading, the customer's CSP must allow our CDN in `script-src`:

```
Content-Security-Policy: script-src 'self' https://cdn.codeweaves.com
```

**GOTCHA:** Some sites use `strict-dynamic` in their CSP, which means only scripts loaded by other trusted scripts are allowed. Our loader script must be the trusted entry point — and dynamic imports from it will be automatically trusted.

---

## 8. Real-World Testing Strategies

### 8.1 Test Harness with Different CSS Frameworks

Create a test harness directory with pages using different frameworks:

```
test-harness/
  ├── bootstrap-5.html
  ├── tailwind-3.html
  ├── material-ui.html
  ├── wordpress-theme.html      (Astra, GeneratePress mocked)
  ├── shopify-dawn.html          (Dawn theme mocked)
  ├── bare-reset.html            (normalize.css only)
  ├── aggressive-css.html        (heavy !important overrides, CSS resets)
  ├── strict-csp.html            (strict CSP headers via meta tag)
  ├── heavy-dom.html             (1000+ DOM elements, heavy JS)
  ├── spa-react.html             (React SPA with route changes)
  ├── spa-nextjs.html            (Next.js with client navigation)
  ├── rtl-page.html              (Right-to-left language page)
  ├── mobile-viewport.html       (viewport meta variations)
  └── jquery-ui-dialog.html      (jQuery UI with overlays)
```

Each page loads our widget script and represents a real-world deployment scenario.

### 8.2 Playwright Testing with Shadow DOM

Playwright pierces Shadow DOM by default — it is the recommended tool for widget E2E testing.

```typescript
// Playwright test example
import { test, expect } from '@playwright/test';

test('widget opens and closes on all test pages', async ({ page }) => {
  const testPages = [
    'bootstrap-5.html',
    'tailwind-3.html',
    'strict-csp.html',
    // ...
  ];

  for (const pageName of testPages) {
    await page.goto(`http://localhost:3000/test-harness/${pageName}`);

    // Playwright pierces shadow DOM automatically
    const trigger = page.getByRole('button', { name: 'Open chat' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const chatWindow = page.getByRole('dialog', { name: 'Customer support chat' });
    await expect(chatWindow).toBeVisible();

    // Test keyboard close
    await page.keyboard.press('Escape');
    await expect(chatWindow).not.toBeVisible();

    // Test focus restoration
    await expect(trigger).toBeFocused();
  }
});

test('widget styles are not affected by host page CSS', async ({ page }) => {
  await page.goto('http://localhost:3000/test-harness/aggressive-css.html');

  const trigger = page.getByRole('button', { name: 'Open chat' });
  const triggerBox = await trigger.boundingBox();

  // Verify trigger button dimensions are correct (not affected by host CSS)
  expect(triggerBox!.width).toBeCloseTo(60, 0);
  expect(triggerBox!.height).toBeCloseTo(60, 0);
});
```

**Cypress alternative:** Use `includeShadowDom: true` in Cypress config, but Playwright is preferred due to native shadow DOM piercing.

### 8.3 Visual Regression Testing

Use Playwright's built-in screenshot comparison:

```typescript
test('widget visual regression', async ({ page }) => {
  await page.goto('http://localhost:3000/test-harness/bootstrap-5.html');
  const trigger = page.getByRole('button', { name: 'Open chat' });
  await trigger.click();

  // Screenshot just the widget area
  const chatWindow = page.getByRole('dialog');
  await expect(chatWindow).toHaveScreenshot('chat-open-bootstrap.png', {
    maxDiffPixelRatio: 0.01,
  });
});
```

Run across multiple browsers: Chromium, Firefox, WebKit (Safari proxy).

### 8.4 Mobile Testing

```typescript
// playwright.config.ts
import { devices } from '@playwright/test';

export default {
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Desktop Safari', use: { ...devices['Desktop Safari'] } },
    { name: 'iPhone 14', use: { ...devices['iPhone 14'] } },
    { name: 'iPhone 14 Pro Max', use: { ...devices['iPhone 14 Pro Max'] } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
    { name: 'iPad Pro', use: { ...devices['iPad Pro 11'] } },
  ],
};
```

**IMPORTANT:** Playwright's mobile emulation does NOT accurately simulate iOS Safari keyboard behavior or safe area insets. For those, you MUST test on real devices using BrowserStack or Sauce Labs.

### 8.5 Accessibility Testing

```typescript
// Automated a11y testing with axe-core
import AxeBuilder from '@axe-core/playwright';

test('widget meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('http://localhost:3000/test-harness/bare-reset.html');
  const trigger = page.getByRole('button', { name: 'Open chat' });
  await trigger.click();

  const results = await new AxeBuilder({ page })
    .include('codeweaves-widget') // axe-core can pierce shadow DOM
    .analyze();

  expect(results.violations).toEqual([]);
});
```

**Manual testing checklist:**
- [ ] NVDA + Chrome on Windows: Navigate widget, send message, hear new messages announced
- [ ] JAWS + Chrome on Windows: Same flow
- [ ] VoiceOver + Safari on macOS: Same flow
- [ ] VoiceOver + Safari on iPhone: Same flow, plus keyboard handling
- [ ] TalkBack + Chrome on Android: Same flow

### 8.6 Performance Monitoring

```typescript
// Measure widget impact on host page
test('widget does not impact host page CWV', async ({ page }) => {
  // Measure without widget
  await page.goto('http://localhost:3000/test-harness/heavy-dom.html?no-widget');
  const baseMetrics = await page.evaluate(() => {
    return new Promise((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        resolve({
          lcp: entries.find(e => e.entryType === 'largest-contentful-paint')?.startTime,
          cls: entries.reduce((sum, e: any) => sum + (e.value || 0), 0),
        });
      }).observe({ entryTypes: ['largest-contentful-paint', 'layout-shift'] });
      setTimeout(resolve, 5000, { lcp: 0, cls: 0 }); // Timeout fallback
    });
  });

  // Measure with widget
  await page.goto('http://localhost:3000/test-harness/heavy-dom.html');
  const widgetMetrics = await page.evaluate(() => { /* same as above */ });

  // Widget should not increase LCP by more than 100ms
  // Widget should not increase CLS by more than 0.01
});
```

---

## Summary: Critical Implementation Checklist

### Must-Have (Ship Blockers)

- [ ] Shadow DOM with `mode: 'open'` for style isolation
- [ ] `all: initial` on `:host` to reset inherited styles
- [ ] Constructable Stylesheets (primary) with `<style>` fallback
- [ ] Singleton guard to prevent double-loading
- [ ] Two-phase lazy loading (tiny loader + full widget on click)
- [ ] VisualViewport API for iOS Safari keyboard handling
- [ ] `overscroll-behavior: contain` on scrollable areas
- [ ] Mobile scroll lock (position: fixed body technique)
- [ ] Focus trap when chat is open
- [ ] Focus restoration on close
- [ ] Escape to close
- [ ] `aria-live="polite"` message region with `role="log"`
- [ ] `role="dialog"` + `aria-modal="true"` on chat window
- [ ] `aria-label`, `aria-haspopup`, `aria-expanded` on trigger
- [ ] `prefers-reduced-motion` support
- [ ] Complete destroy() method with all cleanup
- [ ] MutationObserver for SPA self-healing
- [ ] CSP documentation for customers
- [ ] `z-index: 2147483647` on widget host
- [ ] Safe area inset handling

### Should-Have (Post-Launch)

- [ ] Container queries for responsive widget sizing
- [ ] Message virtualization for long sessions
- [ ] Color contrast validation at theme configuration time
- [ ] RTL language support
- [ ] Test harness with all CSS frameworks
- [ ] Playwright E2E test suite with visual regression
- [ ] Real device testing (BrowserStack) in CI
- [ ] Performance budget monitoring
- [ ] High contrast mode toggle
- [ ] Nonce support for strict CSP sites

---

## Sources

- [Viewport Resize Behavior Explainer (Bramus)](https://github.com/bramus/viewport-resize-behavior/blob/main/explainer.md)
- [VirtualKeyboard API (Bram.us)](https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/)
- [Safari Mobile Resizing Bug Guide](https://medium.com/@krutilin.sergey.ks/fixing-the-safari-mobile-resizing-bug-a-developers-guide-6568f933cde0)
- [interactive-widget Control (HTMHell)](https://www.htmhell.dev/adventcalendar/2024/4/)
- [Fix Mobile Keyboard Overlap with VisualViewport](https://dev.to/franciscomoretti/fix-mobile-keyboard-overlap-with-visualviewport-3a4a)
- [CSS dvh Dynamic Viewport Height](https://savvy.co.il/en/blog/css/css-dynamic-viewport-height-dvh/)
- [Viewport Units Guide (web.dev)](https://web.dev/blog/viewport-units)
- [Accessibility and Shadow DOM (Marcy Sutton)](https://marcysutton.com/accessibility-and-the-shadow-dom/)
- [Dialogs and Shadow DOM Accessibility (Nolan Lawson)](https://nolanlawson.com/2022/06/14/dialogs-and-shadow-dom-can-we-make-it-accessible/)
- [Shadow DOM and Accessibility Conflict (Alice Boxhall)](https://alice.pages.igalia.com/blog/how-shadow-dom-and-accessibility-are-in-conflict/)
- [Focus Trap for Accessible Web Components (Southleft)](https://southleft.com/insights/design-systems/focus-trap-accessible-web-components/)
- [Managing Focus in Shadow DOM (Nolan Lawson)](https://nolanlawson.com/2021/02/13/managing-focus-in-the-shadow-dom/)
- [ARIA Live Regions (Sara Soueidan)](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)
- [aria-live in Angular, React, Vue (k9n.dev)](https://k9n.dev/blog/2025-11-aria-live/)
- [Preventing Body Scroll on iOS (pqina.nl)](https://pqina.nl/blog/how-to-prevent-scrolling-the-page-on-ios-safari/)
- [Body Scroll Lock for iOS (Ben Frain)](https://benfrain.com/preventing-body-scroll-for-modals-in-ios/)
- [Overscroll Behavior (Ahmad Shadeed)](https://ishadeed.com/article/prevent-scroll-chaining-overscroll-behavior/)
- [Shadow DOM CSS Isolation (Medium)](https://medium.com/rate-engineering/winning-the-war-of-css-conflicts-through-the-shadow-dom-de6c797b5cba)
- [Style Blocker with Shadow DOM](https://matthewjamestaylor.com/style-blocker/)
- [Shadow DOM Security Guide 2025](https://cybersguards.com/shadow-dom/)
- [Shadow DOM CSP Issue (WICG/webcomponents)](https://github.com/WICG/webcomponents/issues/627)
- [Zendesk Widget CSP Documentation](https://developer.zendesk.com/documentation/zendesk-web-widget-sdks/sdks/web/csp/)
- [CSP style-src Directive (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src)
- [Embeddable Widget with Preact and Shadow DOM (CompanyCam)](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)
- [Production-Ready Embeddable React Widgets (MakerKit)](https://makerkit.dev/blog/tutorials/embeddable-widgets-react)
- [Preact in Shadow DOM (Dev.to)](https://dev.to/tryeladd/preact-in-the-shadow-dom-ao8)
- [Async/Defer Script Loading (javascript.info)](https://javascript.info/script-async-defer)
- [Creating Embeddable JS Widgets (Brendan Graetz)](https://blog.bguiz.com/articles/embeddable-widgets-html-javascript/)
- [Subresource Integrity (MDN)](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity)
- [SRI Best Practices (OWASP)](https://owasp.org/www-community/controls/SubresourceIntegrity)
- [Container Queries 2026 (LogRocket)](https://blog.logrocket.com/container-queries-2026/)
- [CSS Container Queries (Can I Use)](https://caniuse.com/css-container-queries)
- [env() Safe Area Insets (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [Safe Area Insets Guide (Medium)](https://medium.com/@developerr.ayush/understanding-env-safe-area-insets-in-css-from-basics-to-react-and-tailwind-a0b65811a8ab)
- [prefers-reduced-motion (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Accessible Animations (Pope Tech)](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [Shadow DOM Playwright Testing (Medium)](https://medium.com/@erik.amaral/shadow-dom-testing-that-doesnt-flake-using-playwright-1c9313d086d3)
- [Playwright Selectors Best Practices 2026 (BrowserStack)](https://www.browserstack.com/guide/playwright-selectors-best-practices)
- [iOS 26 VisualViewport Bug (Apple Forums)](https://developer.apple.com/forums/thread/800125)
- [Fixing Memory Leaks in React (freeCodeCamp)](https://www.freecodecamp.org/news/fix-memory-leaks-in-react-apps/)
