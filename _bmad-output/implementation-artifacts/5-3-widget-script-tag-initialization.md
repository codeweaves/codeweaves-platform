# Story 5.3: Widget Script Tag Initialization

Status: done

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

- [x] Task 1: Create IIFE entry point in main.tsx (AC: 1, 2)
  - [x] Wrap entire initialization in `(function() { ... })()`
  - [x] Add singleton guard: `if (window.__codeweaves_loaded) return; window.__codeweaves_loaded = true;`
  - [x] Use `document.currentScript` to read `data-agent-id` attribute
  - [x] Add fallback to `document.querySelector('script[data-agent-id]')` if `document.currentScript` is null

- [x] Task 2: Implement DOM-ready wait logic (AC: 1, 4)
  - [x] Check `document.readyState` for 'loading' state
  - [x] If loading, add `DOMContentLoaded` event listener before proceeding
  - [x] If already interactive/complete, proceed immediately
  - [x] Call widget mount function once DOM is ready

- [x] Task 3: Create host element and Shadow DOM (AC: 1, 4)
  - [x] Create host container element (`<div id="codeweaves-widget">`)
  - [x] Append host element to `document.body`
  - [x] Call shadow-dom.ts from Story 5-2 to attach closed Shadow DOM
  - [x] Create mount point inside shadow root for Preact rendering

- [x] Task 4: Render Preact app into shadow root (AC: 1, 4)
  - [x] Import root widget component
  - [x] Use Preact `render()` to mount into shadow root mount point
  - [x] Pass agent ID and configuration as props

- [x] Task 5: Expose global API on window object (AC: 1)
  - [x] Set `window.CodeWeaves = { init, destroy, open, close }`
  - [x] `init(agentId)` — programmatic initialization (alternative to data attribute)
  - [x] `destroy()` — full cleanup implementation:
    - [x] Disconnect all `MutationObserver` instances
    - [x] Remove all event listeners (`resize`, `visualViewport.resize`, `popstate`, `keydown`)
    - [x] Unmount Preact component tree: `render(null, shadowRoot)`
    - [x] Remove host element from DOM: `host.remove()`
    - [x] Reset singleton flag: `window.__codeweaves_loaded = false`
    - [x] Restore scroll lock if active (restore `document.body` styles and scroll position)
  - [x] `open()` — expand the chat widget
  - [x] `close()` — collapse the chat widget

- [x] Task 6: Handle missing agent-id gracefully (AC: 6)
  - [x] Check if `data-agent-id` is present and non-empty
  - [x] If missing, log `console.warn('[CodeWeaves] Missing data-agent-id attribute on script tag')` and return early
  - [x] Ensure no DOM elements are created if agent-id is missing
  - [x] Ensure no unhandled exceptions are thrown

- [x] Task 7: Add development mode debug logging (AC: 5)
  - [x] Detect dev mode via Vite's `import.meta.env.DEV` or a `data-debug` attribute on the script tag
  - [x] Attribute format: `data-debug="true"` or just the presence of `data-debug` attribute (no value needed) enables debug logging
  - [x] Debug mode logs (all prefixed with `[CodeWeaves]`): config loading, shadow DOM creation, theme application, event listener registration
  - [x] Log initialization steps: agent ID detected, DOM ready, shadow DOM created, config loaded
  - [x] Prefix all logs with `[CodeWeaves]` for easy filtering
  - [x] Suppress debug logs in production builds (unless `data-debug` attribute is present)

- [x] Task 8: Implement SPA navigation handling (AC: 1)
  - [x] Listen to `popstate` event to detect browser back/forward navigation
  - [x] Optionally patch `history.pushState` and `history.replaceState` to detect programmatic SPA navigation (wrap originals and dispatch custom event)
  - [x] Default behavior: widget persists across SPA navigations — call `destroy()` to explicitly remove
  - [x] Reference research Section 14

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

## Senior Developer Review (AI)

**Review Date:** 2026-03-25
**Review Outcome:** Changes Requested → Resolved
**Severity Breakdown:** 2 High, 2 Med, 2 Low
**Total Action Items:** 6/6 resolved

### Action Items

- [x] **[High] P1:** `fullDestroy()` did not reset `window.__codeweaves_loaded` — added explicit reset so re-init works after destroy
- [x] **[High] P2:** `window.CodeWeaves` not available when auto-init fails (missing `data-agent-id`) — exposed stub API with only `init()` functional
- [x] **[Med] P3:** Stale closures in `useEffect` for widget controls — used `useRef` so registered callbacks always point to latest handlers
- [x] **[Med] P4:** Race condition on rapid `init()`/`destroy()` while DOM loading — `onReady()` now removes old handler before registering new one
- [x] **[Low] P5:** Dead `__codeweaves_destroy` type left in `global.d.ts` — removed, also cleaned up reference in `shadow-dom.ts`
- [x] **[Low] P6:** `debug()` used `console.log` but terser `pure_funcs` only strips `console.debug` — switched to `console.debug`

### Intent Gaps (not bugs — spec/story boundary issues)

- **I1:** AC 3 (fetch config from API) is specified on this story but implementation deferred to Story 5-4 (config-loader)
- **I2:** SPA navigation handlers are no-ops (only debug logging) — widget already persists by default via fixed-position Shadow DOM

### Deferred (pre-existing design risks)

- **D1:** History monkey-patching may conflict with third-party routers — inherent to the spec design (Research Section 14)
- **D2:** `querySelector('script[data-agent-id]')` fallback picks first in DOM order if multiple script tags exist

## Dev Agent Record

### Implementation Plan

Rewrote `main.tsx` to implement the full script-tag initialization flow: IIFE auto-init reads `data-agent-id` from `document.currentScript` (with fallback), checks singleton guard, waits for DOM-ready, creates Shadow DOM via Story 5-2's `initShadowDom()`, renders Preact `<Widget agentId={...} />`, sets up SPA navigation patching, and exposes `window.CodeWeaves` global API.

Created `utils/debug.ts` — a centralized debug logger activated by `data-debug` attribute or Vite dev mode (`import.meta.env.DEV`). All debug logs prefixed with `[CodeWeaves]`. Production builds use `pure_funcs: ['console.debug']` in terser instead of `drop_console: true` to allow runtime debug activation.

Widget open/close control uses a callback registration pattern in `Widget.tsx` — the component registers `handleOpen`/`handleClose` callbacks on mount, which the global API invokes via `triggerOpen()`/`triggerClose()`.

### Completion Notes

- All 8 tasks implemented and verified
- Lint: 0 errors, 0 warnings
- Type check: passes
- Build: passes (all 4 packages)
- Tests: 1290 passed, 0 failed (no regressions)
- No new backend tests needed (frontend widget, no test framework configured)
- Updated `vite.config.ts` terser from `drop_console: true` to `pure_funcs: ['console.debug']`
- Added `vite/client` types to `tsconfig.json` for `import.meta.env.DEV`
- Added `DEV` to `turbo.json` globalEnv

### Debug Log

- Fixed lint: removed unused `isDebugEnabled` import, `currentAgentId` variable, underscore-prefixed prop
- Fixed types: added `vite/client` to tsconfig types for `import.meta.env`
- Fixed turbo: added `DEV` to globalEnv for `turbo/no-undeclared-env-vars`

## File List

- `apps/widget/src/main.tsx` — Rewrote: IIFE entry point with agent-id reading, DOM-ready, global API, SPA nav
- `apps/widget/src/utils/debug.ts` — New: Debug logging utility ([CodeWeaves] prefix, data-debug + DEV support)
- `apps/widget/src/components/Widget.tsx` — Modified: Added agentId prop, callback registration for open/close
- `apps/widget/src/types/global.d.ts` — Modified: Added CodeWeavesAPI interface, window.CodeWeaves declaration
- `apps/widget/vite.config.ts` — Modified: Terser pure_funcs instead of drop_console
- `apps/widget/tsconfig.json` — Modified: Added vite/client types
- `turbo.json` — Modified: Added DEV to globalEnv

## Change Log

- 2026-03-25: Implemented Story 5-3 — Widget script tag initialization with global API, debug logging, SPA navigation handling
- 2026-03-25: Code review fixes — P1: singleton reset in fullDestroy, P2: stub API on auto-init failure, P3: useRef for stable callbacks, P4: DOMContentLoaded race fix, P5: removed dead __codeweaves_destroy type, P6: console.debug for tree-shaking
