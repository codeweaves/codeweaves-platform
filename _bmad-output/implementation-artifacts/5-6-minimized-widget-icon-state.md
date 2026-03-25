# Story 5-6: Minimized Widget Icon State

Status: done

## Story
As a **website visitor**, I want to see a chat icon when the widget is closed, so that I know chat support is available.

## Acceptance Criteria
1. Only the floating icon is visible in minimized state (64x64px default)
2. Icon uses configured background color and border radius
3. Icon position follows `iconPosition` setting (left/right)
4. Icon has hover scale animation (1.1x)
5. Clicking the icon opens the chat window

## Tasks / Subtasks
- [x] Create TriggerButton component shell (AC: #1)
  - [x] Create `apps/widget/src/components/TriggerButton.tsx` as a Preact functional component
  - [x] Render a 64x64px button element using `--cw-trigger-size` CSS variable (default 64px)
  - [x] Set `pointer-events: auto` on the button (host has pointer-events: none)
  - [x] Add default inline SVG chat bubble icon (no external asset requests)
  - [x] Add custom icon support: render `<img>` when `iconCustomImage` URL is provided
  - [x] Add `img.onerror` handler that swaps to the default inline SVG on load failure
  - [x] Handle race condition: track mounted state and skip the onerror swap if the component has already unmounted before the image loads/errors
- [x] Apply theme-driven styling from AgentTheme config (AC: #2)
  - [x] Set background color from `config.iconBg` via `--cw-trigger-bg` CSS variable
  - [x] Set border radius from `config.iconBorderRadius` via `--cw-trigger-radius` CSS variable
  - [x] Add box shadow `0 4px 12px rgba(0,0,0,0.15)` for depth
- [x] Implement position logic based on iconPosition config (AC: #3)
  - [x] Position bottom-right by default using `position: fixed`
  - [x] Switch to bottom-left when `config.iconPosition === 'left'`
  - [x] Apply offset from edges using `--cw-trigger-offset` CSS variable (default 24px)
  - [x] Apply safe area inset for bottom: `bottom: calc(24px + env(safe-area-inset-bottom, 0px))`
  - [x] Apply safe area inset for right: `right: calc(24px + env(safe-area-inset-right, 0px))` (or `left` equivalent when `iconPosition === 'left'` using `env(safe-area-inset-left, 0px)`)
- [x] Add hover scale animation (AC: #4)
  - [x] Apply `transform: scale(1.1)` on hover with `transition: transform 150ms ease`
  - [x] Add optional pulse animation (subtle scale pulse) controlled by config flag
- [x] Wire click handler to open chat window (AC: #5)
  - [x] Accept `onClick` callback prop and invoke it on click
  - [x] Parent widget shell toggles state from minimized to expanded on click
- [x] Add accessibility attributes (AC: #1, #5)
  - [x] Set `aria-label="Open chat"` and `role="button"`
  - [x] Ensure keyboard focusable (`tabindex="0"`)
  - [x] Handle Enter and Space key presses to trigger open (explicit `onKeyDown` handler in component code)
  - [x] Add `:focus-visible { outline: 2px solid var(--cw-color-primary); outline-offset: 2px; }` styling for keyboard navigation visibility
- [x] Add constructable stylesheet for TriggerButton (AC: #2, #3, #4)
  - [x] Define styles in the component stylesheet following 3-sheet pattern
  - [x] Use `--cw-*` namespaced CSS variables for all configurable values

## Dev Notes

### Component Details
- **File:** `apps/widget/src/components/TriggerButton.tsx`
- **Framework:** Preact 10.26.0 — use `class` attribute, not `className`
- **Shadow DOM:** All styles via constructable stylesheets inside closed Shadow DOM

### Positioning
- Default position: bottom-right corner
- Offset from edges: `--cw-trigger-offset: 20px`
- Safe area for mobile notch/bar: `bottom: calc(var(--cw-trigger-offset) + env(safe-area-inset-bottom, 0px))`
- Left position mirrors offset to `left` instead of `right`

### Icon Rendering
- Default: inline SVG chat bubble — no network request for the default state
- Custom: `<img src={config.iconCustomImage} />` with `onerror` handler that swaps back to default SVG
- Icon should be centered within the button (flexbox center/center)

### Animations
- Hover: `transform: scale(1.1)`, `transition: transform 150ms ease`
- Optional pulse: `@keyframes cw-pulse { 0% { transform: scale(1) } 50% { transform: scale(1.05) } 100% { transform: scale(1) } }` — toggled via config

### Accessibility
- `aria-label="Open chat"`
- `role="button"`
- `tabindex="0"`
- Keyboard: Enter and Space trigger click

### Project Structure Notes
- Widget app lives in `apps/widget/`
- Uses Preact (not React) — `class` not `className`, `h()` or JSX pragma for Preact
- All interactive elements require `pointer-events: auto` since host element has `pointer-events: none`
- CSS variables use `--cw-*` namespace

### References
- AgentTheme fields: `iconBg`, `iconBorderRadius`, `iconPosition`, `iconCustomImage`
- Agent config fields: `showBubble`, `bubbleDelay` (used by sibling BubbleNotification)
- docs/research-widget-css-isolation.md for Shadow DOM and constructable stylesheet patterns

## Dev Agent Record

### Implementation Plan
- Enhanced existing TriggerButton stub with full feature set
- Used CSS custom properties chain: theme-map (`--cw-icon-*`) → theme.ts aliases (`--cw-trigger-*`) → component CSS
- Position switching via `data-position` attribute on `.cw-widget` container with CSS `[data-position="left"]` selector
- Safe area insets applied via `env()` functions in CSS calc() expressions
- Custom image fallback uses `useRef` for mounted state tracking to prevent React state updates on unmounted component
- `extractIconConfig()` helper in Widget.tsx reads `icon.position`, `icon.customImageUrl`, and `icon.pulse` from nested theme config

### Debug Log
- Fixed lint warnings: SVG attributes `stroke-linecap`/`stroke-linejoin` → `strokeLinecap`/`strokeLinejoin` for Preact JSX compatibility

### Completion Notes
- All acceptance criteria satisfied
- TriggerButton renders 64px (default via CSS variable chain) floating button with default SVG chat icon
- Custom icon support with `<img>` element and automatic fallback to SVG on load failure
- Mounted state ref prevents race condition on unmount during image load
- Theme-driven background color via `--cw-trigger-bg` ← `--cw-icon-bg`, border radius via `--cw-trigger-radius` ← `--cw-icon-radius`
- Position logic: `data-position` attribute on `.cw-widget` drives CSS right/left switching with safe area insets
- Hover animation: `scale(1.1)` with 150ms ease transition; optional pulse animation via `cw-trigger-pulse` class
- Click handler: `onClick` prop invoked on click, keyboard Enter/Space also trigger
- Full accessibility: `role="button"`, `aria-label="Open chat"`, `tabindex="0"`, `:focus-visible` outline
- All styles use `--cw-*` CSS custom properties in constructable stylesheet (3-sheet pattern)
- Lint, type-check, and build all pass

## File List
- `apps/widget/src/components/TriggerButton.tsx` — Enhanced with custom icon, accessibility, keyboard, pulse animation
- `apps/widget/src/components/Widget.tsx` — Added `extractIconConfig()`, passes icon config to TriggerButton, `data-position` on container
- `apps/widget/src/styles/components.ts` — Full trigger button CSS with positioning, hover, focus-visible, pulse, left/right support
- `apps/widget/src/styles/theme.ts` — Added `--cw-trigger-radius` and `--cw-trigger-offset` CSS variable aliases

## Senior Developer Review (AI)

- **Review Date:** 2026-03-25
- **Outcome:** Approved with minor fix
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3-layer parallel review)
- **Total Findings:** 14 raw → 1 patch, 1 bad_spec, 12 rejected
- **Action Items:**
  - [x] **[Med]** Whitespace-only custom image URL not trimmed — added `.trim()` to `extractIconConfig` in Widget.tsx

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| CR-1 | Med | `extractIconConfig` didn't trim whitespace-only `customImageUrl` strings, allowing invalid URLs to pass to `<img src>` | Added `.trim()` to URL extraction in `extractIconConfig()` |

## Change Log
- 2026-03-25: Implemented full TriggerButton component with custom icon, theme-driven styling, left/right positioning, hover/pulse animations, accessibility, and keyboard support
- 2026-03-25: Code review — fixed whitespace-only URL validation in extractIconConfig
