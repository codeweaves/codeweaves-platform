# Story 5-8: Expanded Chat Window State

Status: ready-for-dev

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
- [ ] Create ChatWindow component shell (AC: #1, #2)
  - [ ] Create `apps/widget/src/components/ChatWindow.tsx` as a Preact functional component
  - [ ] Accept props: agent config, agent theme, `onClose` callback, `onMinimize` callback, trigger position (left/right)
  - [ ] Set size via CSS variables: `--cw-chat-width` (380px), `--cw-chat-height` (520px), `--cw-chat-max-height` (80vh)
  - [ ] Position above trigger button, aligned to same side (left/right)
  - [ ] Apply box shadow `0 8px 30px rgba(0,0,0,0.2)` for elevation
  - [ ] Apply border radius `--cw-chat-radius` (12px default)
  - [ ] Set `pointer-events: auto` on the window container
- [ ] Implement open animation (AC: #1)
  - [ ] Animate from `scale(0.5) + opacity(0)` to `scale(1) + opacity(1)`
  - [ ] Set `transform-origin` to the trigger button corner (bottom-right or bottom-left based on position)
  - [ ] Duration: 300ms ease-out
  - [ ] Use CSS animation or Preact state transition
- [ ] Create ChatHeader sub-component (AC: #3, #4)
  - [ ] Create `apps/widget/src/components/ChatHeader.tsx`
  - [ ] Display agent name from `config.name`
  - [ ] Display subtitle from `theme.headerSubtitle`
  - [ ] Display logo from `theme.headerLogo` with max-height 32px
  - [ ] Fallback: if no logo, render first-letter avatar (first letter of agent name in a circle)
  - [ ] Style with `--cw-header-bg`, `--cw-header-text`, `--cw-header-height` (56px)
  - [ ] Add minimize button (dash icon) — calls `onMinimize` callback
  - [ ] Add close button (X icon) — calls `onClose` callback
  - [ ] Both buttons: `pointer-events: auto`, hover state, accessible labels
- [ ] Create MessageArea sub-component stub (AC: #5)
  - [ ] Create `apps/widget/src/components/MessageArea.tsx`
  - [ ] Render a scrollable container with `flex-grow: 1`, `overflow-y: auto`
  - [ ] Apply `overscroll-behavior: contain` to prevent scroll chaining
    - Also include `-webkit-overflow-scrolling: touch` for iOS momentum scrolling — reference research Section 9.4
  - [ ] Set background from `--cw-chat-bg`
  - [ ] Stub content: display conversation starters or empty state (filled in Story 5-9)
- [ ] Create ChatInput sub-component stub (AC: #6)
  - [ ] Create `apps/widget/src/components/ChatInput.tsx`
  - [ ] Render text input field with send button
  - [ ] Apply `border-top` separator between message area and input
  - [ ] Input: `pointer-events: auto`, placeholder text "Type a message..."
  - [ ] Stub only — actual send logic implemented in later stories
- [ ] Implement auto-focus on input field (AC: #6)
  - [ ] After open animation completes (300ms), focus the input field
  - [ ] Use `setTimeout` or `onanimationend` to delay focus until animation finishes
  - [ ] Use Preact `ref` to access the input DOM element
- [ ] Implement mobile fullscreen mode (AC: #2)
  - [ ] Detect viewport width < 480px (media query or JS check)
  - [ ] On mobile: `position: fixed; top: 0; left: 0; width: 100%; height: 100svh`
  - [ ] Remove border radius on mobile fullscreen
  - [ ] Apply scroll lock: prevent background page scroll when chat is open
    - Use `position: fixed` technique on body (NOT `overflow: hidden` — broken on iOS Safari 15+)
    - Save `document.documentElement.scrollTop` before locking
    - Restore scroll position on chat close
    - Reference: docs/research-widget-css-isolation.md Section 9.3
  - [ ] Support safe area insets: `padding-top: env(safe-area-inset-top, 0px)`
- [ ] Implement iOS keyboard handling (AC: #6)
  - [ ] Use VisualViewport API to detect keyboard open/close
  - [ ] Listen to `window.visualViewport` resize event
  - [ ] Calculate keyboard height: `window.innerHeight - visualViewport.height`
  - [ ] Apply `translateY(-keyboardHeight)` or reduce chat window max-height to keep input field visible above keyboard
  - [ ] Reposition chat window or adjust height when iOS keyboard appears
  - [ ] Ensure input field stays visible above the keyboard
- [ ] Implement keyboard interactions (AC: #4, #6)
  - [ ] Escape key closes the chat window
  - [ ] Implement focus trap: Tab cycles within the chat window when open
    - Note: Use `shadowRoot.activeElement` (NOT `document.activeElement`) to track focus inside closed Shadow DOM — reference research Section 10
  - [ ] First focusable: minimize button; last focusable: input field / send button
  - [ ] Shift+Tab from first element wraps to last; Tab from last wraps to first
- [ ] Add ARIA attributes (AC: #3, #4, #5, #6)
  - [ ] Chat window: `role="dialog"`, `aria-modal="true"`, `aria-label="Chat with {agentName}"`
  - [ ] Close button: `aria-label="Close chat"`
  - [ ] Minimize button: `aria-label="Minimize chat"`
  - [ ] Input field: `aria-label="Message input"`
- [ ] Add constructable stylesheets for all sub-components (AC: #1, #2, #3)
  - [ ] ChatWindow styles: size, position, animation, shadow, radius
  - [ ] ChatHeader styles: layout, colors, button styles
  - [ ] MessageArea styles: scroll, background
  - [ ] ChatInput styles: input, send button, border
  - [ ] Mobile overrides via media query within stylesheets
  - [ ] All CSS variables use `--cw-*` namespace
  - [ ] **CSP compliance:** All styles MUST use constructable stylesheets (`new CSSStyleSheet()` + `adoptedStyleSheets`), NOT inline `<style>` tags — blocked by CSP `style-src` on enterprise sites. Reference research Section 11

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
