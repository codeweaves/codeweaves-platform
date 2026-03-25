# Story 5-6: Minimized Widget Icon State

Status: ready-for-dev

## Story
As a **website visitor**, I want to see a chat icon when the widget is closed, so that I know chat support is available.

## Acceptance Criteria
1. Only the floating icon is visible in minimized state (64x64px default)
2. Icon uses configured background color and border radius
3. Icon position follows `iconPosition` setting (left/right)
4. Icon has hover scale animation (1.1x)
5. Clicking the icon opens the chat window

## Tasks / Subtasks
- [ ] Create TriggerButton component shell (AC: #1)
  - [ ] Create `apps/widget/src/components/TriggerButton.tsx` as a Preact functional component
  - [ ] Render a 64x64px button element using `--cw-trigger-size` CSS variable (default 64px)
  - [ ] Set `pointer-events: auto` on the button (host has pointer-events: none)
  - [ ] Add default inline SVG chat bubble icon (no external asset requests)
  - [ ] Add custom icon support: render `<img>` when `iconCustomImage` URL is provided
  - [ ] Add `img.onerror` handler that swaps to the default inline SVG on load failure
  - [ ] Handle race condition: track mounted state and skip the onerror swap if the component has already unmounted before the image loads/errors
- [ ] Apply theme-driven styling from AgentTheme config (AC: #2)
  - [ ] Set background color from `config.iconBg` via `--cw-trigger-bg` CSS variable
  - [ ] Set border radius from `config.iconBorderRadius` via `--cw-trigger-radius` CSS variable
  - [ ] Add box shadow `0 4px 12px rgba(0,0,0,0.15)` for depth
- [ ] Implement position logic based on iconPosition config (AC: #3)
  - [ ] Position bottom-right by default using `position: fixed`
  - [ ] Switch to bottom-left when `config.iconPosition === 'left'`
  - [ ] Apply offset from edges using `--cw-trigger-offset` CSS variable (default 24px)
  - [ ] Apply safe area inset for bottom: `bottom: calc(24px + env(safe-area-inset-bottom, 0px))`
  - [ ] Apply safe area inset for right: `right: calc(24px + env(safe-area-inset-right, 0px))` (or `left` equivalent when `iconPosition === 'left'` using `env(safe-area-inset-left, 0px)`)
- [ ] Add hover scale animation (AC: #4)
  - [ ] Apply `transform: scale(1.1)` on hover with `transition: transform 150ms ease`
  - [ ] Add optional pulse animation (subtle scale pulse) controlled by config flag
- [ ] Wire click handler to open chat window (AC: #5)
  - [ ] Accept `onClick` callback prop and invoke it on click
  - [ ] Parent widget shell toggles state from minimized to expanded on click
- [ ] Add accessibility attributes (AC: #1, #5)
  - [ ] Set `aria-label="Open chat"` and `role="button"`
  - [ ] Ensure keyboard focusable (`tabindex="0"`)
  - [ ] Handle Enter and Space key presses to trigger open (explicit `onKeyDown` handler in component code)
  - [ ] Add `:focus-visible { outline: 2px solid var(--cw-color-primary); outline-offset: 2px; }` styling for keyboard navigation visibility
- [ ] Add constructable stylesheet for TriggerButton (AC: #2, #3, #4)
  - [ ] Define styles in the component stylesheet following 3-sheet pattern
  - [ ] Use `--cw-*` namespaced CSS variables for all configurable values

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
