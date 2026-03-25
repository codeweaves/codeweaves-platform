# Story 5-8: Expanded Chat Window State

Status: done

## Story
As a **website visitor**, I want to open the full chat interface, so that I can have a conversation with the AI agent.

## Acceptance Criteria
1. Window animates from icon position (300ms ease-out)
2. Window displays at configured size (380x520px default)
3. Header shows agent name, subtitle, and logo
4. Minimize and close buttons are functional
5. Message area is scrollable
6. Input field is focused automatically

## Tasks / Subtasks
- [x] Create ChatWindow component shell (AC: #1, #2)
  - [x] Create `apps/widget/src/components/ChatWindow.tsx` as a Preact functional component
  - [x] Accept props: agent config, agent theme, `onClose` callback, `onMinimize` callback, trigger position (left/right)
  - [x] Set size via CSS variables: `--cw-chat-width` (380px), `--cw-chat-height` (520px), `--cw-chat-max-height` (80vh)
  - [x] Position above trigger button, aligned to same side (left/right)
  - [x] Apply box shadow `0 8px 30px rgba(0,0,0,0.2)` for elevation
  - [x] Apply border radius `--cw-chat-radius` (12px default)
  - [x] Set `pointer-events: auto` on the window container
- [x] Implement open animation (AC: #1)
  - [x] Animate from `scale(0.5) + opacity(0)` to `scale(1) + opacity(1)`
  - [x] Set `transform-origin` to the trigger button corner (bottom-right or bottom-left based on position)
  - [x] Duration: 300ms ease-out
  - [x] Use CSS animation or Preact state transition
- [x] Create ChatHeader sub-component (AC: #3, #4)
  - [x] Create `apps/widget/src/components/ChatHeader.tsx`
  - [x] Display agent name from `config.name`
  - [x] Display subtitle from `theme.headerSubtitle`
  - [x] Display logo from `theme.headerLogo` with max-height 32px
  - [x] Fallback: if no logo, render first-letter avatar (first letter of agent name in a circle)
  - [x] Style with `--cw-header-bg`, `--cw-header-text`, `--cw-header-height` (56px)
  - [x] Add minimize button (dash icon) — calls `onMinimize` callback
  - [x] Add close button (X icon) — calls `onClose` callback
  - [x] Both buttons: `pointer-events: auto`, hover state, accessible labels
- [x] Create MessageArea sub-component stub (AC: #5)
  - [x] Create `apps/widget/src/components/MessageArea.tsx`
  - [x] Render a scrollable container with `flex-grow: 1`, `overflow-y: auto`
  - [x] Apply `overscroll-behavior: contain` to prevent scroll chaining
    - Also include `-webkit-overflow-scrolling: touch` for iOS momentum scrolling — reference research Section 9.4
  - [x] Set background from `--cw-chat-bg`
  - [x] Stub content: display conversation starters or empty state (filled in Story 5-9)
- [x] Create ChatInput sub-component stub (AC: #6)
  - [x] Create `apps/widget/src/components/ChatInput.tsx`
  - [x] Render text input field with send button
  - [x] Apply `border-top` separator between message area and input
  - [x] Input: `pointer-events: auto`, placeholder text "Type a message..."
  - [x] Stub only — actual send logic implemented in later stories
- [x] Implement auto-focus on input field (AC: #6)
  - [x] After open animation completes (300ms), focus the input field
  - [x] Use `setTimeout` or `onanimationend` to delay focus until animation finishes
  - [x] Use Preact `ref` to access the input DOM element
- [x] Implement mobile fullscreen mode (AC: #2)
  - [x] Detect viewport width < 480px (media query or JS check)
  - [x] On mobile: `position: fixed; top: 0; left: 0; width: 100%; height: 100svh`
  - [x] Remove border radius on mobile fullscreen
  - [x] Apply scroll lock: prevent background page scroll when chat is open
    - Use `position: fixed` technique on body (NOT `overflow: hidden` — broken on iOS Safari 15+)
    - Save `document.documentElement.scrollTop` before locking
    - Restore scroll position on chat close
    - Reference: docs/research-widget-css-isolation.md Section 9.3
  - [x] Support safe area insets: `padding-top: env(safe-area-inset-top, 0px)`
- [x] Implement iOS keyboard handling (AC: #6)
  - [x] Use VisualViewport API to detect keyboard open/close
  - [x] Listen to `window.visualViewport` resize event
  - [x] Calculate keyboard height: `window.innerHeight - visualViewport.height`
  - [x] Apply `translateY(-keyboardHeight)` or reduce chat window max-height to keep input field visible above keyboard
  - [x] Reposition chat window or adjust height when iOS keyboard appears
  - [x] Ensure input field stays visible above the keyboard
- [x] Implement keyboard interactions (AC: #4, #6)
  - [x] Escape key closes the chat window
  - [x] Implement focus trap: Tab cycles within the chat window when open
    - Note: Use `shadowRoot.activeElement` (NOT `document.activeElement`) to track focus inside closed Shadow DOM — reference research Section 10
  - [x] First focusable: minimize button; last focusable: input field / send button
  - [x] Shift+Tab from first element wraps to last; Tab from last wraps to first
- [x] Add ARIA attributes (AC: #3, #4, #5, #6)
  - [x] Chat window: `role="dialog"`, `aria-modal="true"`, `aria-label="Chat with {agentName}"`
  - [x] Close button: `aria-label="Close chat"`
  - [x] Minimize button: `aria-label="Minimize chat"`
  - [x] Input field: `aria-label="Message input"`
- [x] Add constructable stylesheets for all sub-components (AC: #1, #2, #3)
  - [x] ChatWindow styles: size, position, animation, shadow, radius
  - [x] ChatHeader styles: layout, colors, button styles
  - [x] MessageArea styles: scroll, background
  - [x] ChatInput styles: input, send button, border
  - [x] Mobile overrides via media query within stylesheets
  - [x] All CSS variables use `--cw-*` namespace
  - [x] **CSP compliance:** All styles MUST use constructable stylesheets (`new CSSStyleSheet()` + `adoptedStyleSheets`), NOT inline `<style>` tags — blocked by CSP `style-src` on enterprise sites. Reference research Section 11

## Dev Notes

### Component Hierarchy
```
ChatWindow.tsx
├── ChatHeader.tsx    — agent info + minimize/close buttons
├── MessageArea.tsx   — scrollable message container (stub)
└── ChatInput.tsx     — text input + send button (stub)
```

### Component Details
- **Files:** `apps/widget/src/components/ChatWindow.tsx`, `ChatHeader.tsx`, `MessageArea.tsx`, `ChatInput.tsx`
- **Framework:** Preact 10.26.0 — use `class` attribute, not `className`
- **Shadow DOM:** All styles via constructable stylesheets inside closed Shadow DOM

### Animation
- Open: `@keyframes cw-chat-open { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }`
- Duration: 300ms ease-out
- Transform origin: bottom-right corner (or bottom-left if `iconPosition === 'left'`)
- Close: reverse animation or immediate hide

### Sizing and Position
- Desktop: `width: var(--cw-chat-width, 380px); height: var(--cw-chat-height, 520px); max-height: var(--cw-chat-max-height, 80vh)`
- Position: `fixed`, above trigger button, offset by trigger size + gap
- Mobile (<480px): fullscreen with `width: 100%; height: 100svh; top: 0; left: 0; border-radius: 0`

### Mobile Considerations
- Fullscreen breakpoint: 480px
- Use `100svh` (small viewport height) to account for mobile browser chrome
- Safe area insets for notched devices
- Scroll lock: set `overflow: hidden` on host body or use `position: fixed` technique
- iOS keyboard: listen to `window.visualViewport.resize` event to adjust layout
- Reference: docs/research-widget-css-isolation.md Sections 9, 10

### Focus Management
- Focus trap keeps Tab/Shift+Tab within the dialog
- Auto-focus input after animation (300ms delay)
- Escape key handler on the dialog container to close
- Restore focus to trigger button when chat closes

### Header Layout
```
[Logo/Avatar] [Name + Subtitle]         [—] [X]
```
- Logo: `max-height: 32px`, fallback to first-letter avatar (colored circle)
- Name: primary text, bold
- Subtitle: secondary text, smaller, lighter

### Accessibility
- `role="dialog"` with `aria-modal="true"` on the chat window
- `aria-label="Chat with {agentName}"` dynamically set
- All buttons have descriptive `aria-label` attributes
- Focus trap implementation for keyboard navigation

### Project Structure Notes
- Widget app lives in `apps/widget/`
- Uses Preact (not React) — `class` not `className`
- All interactive elements require `pointer-events: auto`
- CSS variables use `--cw-*` namespace

### References
- AgentTheme fields: `headerBg`, `headerTextColor`, `headerSubtitle`, `headerLogo`, `chatBg`
- Agent config fields: `name`, `conversationStarters[]`
- docs/research-widget-css-isolation.md Sections 9, 10 for mobile and iOS keyboard handling
- Story 5-6 (TriggerButton) for trigger position context
- Story 5-13 (minimize state) for onMinimize callback behavior

## File List
- `apps/widget/src/components/ChatWindow.tsx` — Modified: Full chat window with animation, mobile fullscreen, iOS keyboard, focus trap, ARIA
- `apps/widget/src/components/ChatHeader.tsx` — New: Header with agent name/logo/subtitle, minimize/close buttons
- `apps/widget/src/components/MessageArea.tsx` — New: Scrollable message area stub
- `apps/widget/src/components/ChatInput.tsx` — New: Input field with send button stub, forwardRef for focus
- `apps/widget/src/components/Widget.tsx` — Modified: Pass agentConfig, theme, onMinimize, position to ChatWindow
- `apps/widget/src/styles/components.ts` — Modified: Full CSS for chat window, header, message area, input, mobile overrides
- `apps/widget/src/styles/theme.ts` — Modified: Added --cw-chat-width/height/max-height/radius, --cw-header-height variables
- `apps/widget/eslint.config.js` — Modified: Added Preact-specific attribute names to eslint ignore list

## Change Log
- 2026-03-25: Implemented expanded chat window state (Story 5-8) — ChatWindow, ChatHeader, MessageArea, ChatInput components with open animation, mobile fullscreen, iOS keyboard handling, focus trap, and full ARIA accessibility
- 2026-03-25: Addressed code review findings — 6 items resolved (P1-P6)

## Dev Agent Record

### Implementation Plan
- Replaced placeholder ChatWindow with full implementation accepting agentConfig, theme, onClose, onMinimize, position props
- Created ChatHeader with logo/first-letter-avatar fallback, agent name, subtitle, minimize/close buttons
- Created MessageArea stub with scrollable container, overscroll-behavior: contain, -webkit-overflow-scrolling: touch
- Created ChatInput stub with forwardRef for auto-focus, input field with placeholder, disabled send button
- Animation: CSS @keyframes cw-chat-open (scale 0.5→1, opacity 0→1), 300ms ease-out, transform-origin based on position prop
- Mobile: @media (max-width: 479px) fullscreen with 100svh, safe area insets, scroll lock via lockScroll/unlockScroll from shadow-dom.ts
- iOS keyboard: VisualViewport API resize listener, reduces max-height by keyboard height
- Focus trap: Tab/Shift+Tab cycles within dialog, uses getRootNode().activeElement for Shadow DOM
- All styles in constructable stylesheets (CSP-safe) via components.ts with --cw-* namespace

### Debug Log
- Lint warning: Preact uses lowercase HTML attributes (autocomplete, stroke-linecap, stroke-linejoin) — added to eslint ignore list
- Lint warning: Removed unused firstFocusableRef variable

### Completion Notes
- All 12 tasks and subtasks completed
- All 6 acceptance criteria satisfied
- Lint, type-check, and build all pass
- Widget bundle: 52.25 kB (16.86 kB gzipped)

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | Med | `isMobile` computed once, not reactive to resize/orientation | Added resize event listener updating `isMobile` state |
| P2 | Med | Message area uses `--cw-body-bg` instead of spec's `--cw-chat-bg` | Changed to `var(--cw-chat-bg, var(--cw-body-bg, ...))` |
| P3 | Med | Missing bottom safe area inset on mobile fullscreen | Added `padding-bottom: env(safe-area-inset-bottom, 0px)` |
| P4 | Low | Header logo `<img>` has no onError fallback | Added `onError` handler + `logoFailed` state to fall back to LetterAvatar |
| P5 | Med | `logoUrl` not validated for safe URL schemes (XSS risk) | Added `isSafeUrl()` that only allows `https?://` schemes |
| P6 | Low | iOS keyboard height spikes during orientation change | Added `MAX_KEYBOARD_RATIO` (0.6) cap to filter spurious values |

## Senior Developer Review (AI)

- **Review Date:** 2026-03-25
- **Outcome:** Changes Requested (6 items)
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 17 raw → 6 actionable (11 rejected as noise)
- **Action Items:**
  - [x] P1 (Med): Make `isMobile` reactive to resize/orientation changes
  - [x] P2 (Med): Fix message area background to use `--cw-chat-bg`
  - [x] P3 (Med): Add bottom safe area inset on mobile fullscreen
  - [x] P4 (Low): Add `onError` fallback for header logo `<img>`
  - [x] P5 (Med): Validate `logoUrl` for safe URL schemes
  - [x] P6 (Low): Cap iOS keyboard height to prevent orientation spike
