# Story 5.3: Widget Script Tag Initialization

Status: ready-for-dev

## Story

As a **website owner**,
I want to embed the widget with a simple script tag,
So that I can add it to my website without complex setup.

## Acceptance Criteria

1. **Given** a website page with the embed code
   **When** the page loads with `<script src="https://cdn.example.com/widget.js" data-agent-id="xxx"></script>`
   **Then** the widget initializes and renders correctly

2. **Given** the script tag is on the page
   **When** the script executes
   **Then** it reads `data-agent-id` from the script tag

3. **Given** a valid `data-agent-id` is present
   **When** initialization completes
   **Then** it fetches widget configuration from the API

4. **Given** configuration is loaded successfully
   **When** the widget renders
   **Then** it appears in the specified position on the page

5. **Given** the environment is development mode
   **When** the widget initializes
   **Then** helpful debug info is logged to the console

6. **Given** the `data-agent-id` attribute is missing from the script tag
   **When** the script executes
   **Then** it fails gracefully with a console warning and does not crash the host page

## Tasks / Subtasks

- [ ] Task 1: Create IIFE entry point in main.tsx (AC: 1, 2)
  - [ ] Wrap entire initialization in `(function() { ... })()`
  - [ ] Add singleton guard: `if (window.__codeweaves_loaded) return; window.__codeweaves_loaded = true;`
  - [ ] Use `document.currentScript` to read `data-agent-id` attribute
  - [ ] Add fallback to `document.querySelector('script[data-agent-id]')` if `document.currentScript` is null

- [ ] Task 2: Implement DOM-ready wait logic (AC: 1, 4)
  - [ ] Check `document.readyState` for 'loading' state
  - [ ] If loading, add `DOMContentLoaded` event listener before proceeding
  - [ ] If already interactive/complete, proceed immediately
  - [ ] Call widget mount function once DOM is ready

- [ ] Task 3: Create host element and Shadow DOM (AC: 1, 4)
  - [ ] Create host container element (`<div id="codeweaves-widget">`)
  - [ ] Append host element to `document.body`
  - [ ] Call shadow-dom.ts from Story 5-2 to attach closed Shadow DOM
  - [ ] Create mount point inside shadow root for Preact rendering

- [ ] Task 4: Render Preact app into shadow root (AC: 1, 4)
  - [ ] Import root widget component
  - [ ] Use Preact `render()` to mount into shadow root mount point
  - [ ] Pass agent ID and configuration as props

- [ ] Task 5: Expose global API on window object (AC: 1)
  - [ ] Set `window.CodeWeaves = { init, destroy, open, close }`
  - [ ] `init(agentId)` — programmatic initialization (alternative to data attribute)
  - [ ] `destroy()` — full cleanup implementation:
    - [ ] Disconnect all `MutationObserver` instances
    - [ ] Remove all event listeners (`resize`, `visualViewport.resize`, `popstate`, `keydown`)
    - [ ] Unmount Preact component tree: `render(null, shadowRoot)`
    - [ ] Remove host element from DOM: `host.remove()`
    - [ ] Reset singleton flag: `window.__codeweaves_loaded = false`
    - [ ] Restore scroll lock if active (restore `document.body` styles and scroll position)
  - [ ] `open()` — expand the chat widget
  - [ ] `close()` — collapse the chat widget

- [ ] Task 6: Handle missing agent-id gracefully (AC: 6)
  - [ ] Check if `data-agent-id` is present and non-empty
  - [ ] If missing, log `console.warn('[CodeWeaves] Missing data-agent-id attribute on script tag')` and return early
  - [ ] Ensure no DOM elements are created if agent-id is missing
  - [ ] Ensure no unhandled exceptions are thrown

- [ ] Task 7: Add development mode debug logging (AC: 5)
  - [ ] Detect dev mode via Vite's `import.meta.env.DEV` or a `data-debug` attribute on the script tag
  - [ ] Attribute format: `data-debug="true"` or just the presence of `data-debug` attribute (no value needed) enables debug logging
  - [ ] Debug mode logs (all prefixed with `[CodeWeaves]`): config loading, shadow DOM creation, theme application, event listener registration
  - [ ] Log initialization steps: agent ID detected, DOM ready, shadow DOM created, config loaded
  - [ ] Prefix all logs with `[CodeWeaves]` for easy filtering
  - [ ] Suppress debug logs in production builds (unless `data-debug` attribute is present)

- [ ] Task 8: Implement SPA navigation handling (AC: 1)
  - [ ] Listen to `popstate` event to detect browser back/forward navigation
  - [ ] Optionally patch `history.pushState` and `history.replaceState` to detect programmatic SPA navigation (wrap originals and dispatch custom event)
  - [ ] Default behavior: widget persists across SPA navigations — call `destroy()` to explicitly remove
  - [ ] Reference research Section 14

## Dev Notes

### Entry Point Architecture

The entry point is `src/main.tsx`, built as an IIFE by Vite. The entire initialization is wrapped to avoid polluting the global scope:

```typescript
(function() {
  if (window.__codeweaves_loaded) return;
  window.__codeweaves_loaded = true;

  const script = document.currentScript || document.querySelector('script[data-agent-id]');
  const agentId = script?.getAttribute('data-agent-id');

  if (!agentId) {
    console.warn('[CodeWeaves] Missing data-agent-id attribute on script tag');
    return;
  }

  // Wait for DOM, create shadow DOM, render Preact app...
})();
```

### Singleton Guard

The `window.__codeweaves_loaded` flag prevents double-initialization if the script tag is accidentally included twice. The `destroy()` method in the global API resets this flag so re-initialization is possible.

### DOM Ready Pattern

The `document.readyState` property has three possible values:
- `'loading'` — document is still loading; attach a `DOMContentLoaded` listener and wait
- `'interactive'` — DOM is fully parsed but sub-resources (images, stylesheets) may still be loading; safe to init immediately
- `'complete'` — everything including sub-resources is loaded; safe to init immediately

```typescript
function onReady(callback: () => void) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    // 'interactive' or 'complete' — proceed immediately
    callback();
  }
}
```

### Global API

The `window.CodeWeaves` object allows programmatic control for SPAs or advanced integrations:
- `init(agentId: string)` — mount widget with a specific agent ID (for SPAs that can't use data attributes)
- `destroy()` — fully remove widget from DOM, clean up, reset singleton
- `open()` / `close()` — toggle widget visibility

### Project Structure Notes

```
apps/widget/src/
  main.tsx              ← IIFE entry point (this story)
  shadow-dom.ts         ← From Story 5-2 (closed Shadow DOM + constructable stylesheets)
  components/
    Widget.tsx          ← Root widget component
  services/
    config-loader.ts    ← Story 5-4
```

### SPA Navigation Handling

The widget persists across SPA navigations by default. For frameworks like React Router, Vue Router, or Next.js, the widget stays mounted when the user navigates between pages. To detect programmatic navigation (which does not fire `popstate`), optionally wrap `history.pushState` and `history.replaceState`:

```typescript
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

history.pushState = (...args) => {
  originalPushState(...args);
  window.dispatchEvent(new Event('cw:navigation'));
};
history.replaceState = (...args) => {
  originalReplaceState(...args);
  window.dispatchEvent(new Event('cw:navigation'));
};
```

The `destroy()` method must restore the original `pushState`/`replaceState` if they were patched. Reference research Section 14.

### References

- Story 5-2: Shadow DOM setup with closed mode and constructable stylesheets
- Story 5-4: Widget configuration loading (called from init sequence)
- Vite IIFE build config in `apps/widget/vite.config.ts`
- `document.currentScript` MDN: only available during synchronous script execution
- [Source: docs/research-widget-css-isolation.md, Section 14] — SPA navigation and cleanup patterns
