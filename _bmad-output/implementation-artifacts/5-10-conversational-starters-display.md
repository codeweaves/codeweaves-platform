# Story 5-10: Conversational Starters Display

Status: ready-for-dev

## Story
As a **website visitor**, I want to see suggested conversation starters, so that I know what I can ask the agent.

## Acceptance Criteria
1. Up to 4 starter buttons appear below the welcome message
2. Buttons use system message styling
3. Clicking a starter sends it as a user message
4. Starters disappear after the first user message
5. Starters handle long text with truncation

## Tasks / Subtasks
- [ ] Create ConversationStarters component (AC: #1, #2, #5)
  - [ ] Create `apps/widget/src/components/ConversationStarters.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [ ] Accept props: `{ starters: Array<{ message: string }>, onSelect: (message: string) => void, visible: boolean }`
  - [ ] Render up to 4 starter buttons from `config.conversationStarters` (each item has a `.message` field, max 80 chars per Story 4-18)
  - [ ] Layout: flex-wrap horizontal row so buttons wrap to the next line when space is limited
- [ ] Style starter buttons (AC: #2, #5)
  - [ ] Pill-shaped outline buttons with `--cw-color-primary` border
  - [ ] Small padding for compact appearance
  - [ ] Hover state: fill with `--cw-color-primary`, text becomes white
    - Use `@media (hover: hover)` for hover states to avoid stuck hover on touch devices
  - [ ] Apply `text-overflow: ellipsis`, `overflow: hidden`, `white-space: nowrap` for starters that exceed container width
  - [ ] Define styles as constructable stylesheet within Shadow DOM using `--cw-*` variables
- [ ] Implement click-to-send behavior (AC: #3)
  - [ ] On button click, call `onSelect(starter.message)`
  - [ ] Parent component handles adding the message as a user message and sending to the API
- [ ] Implement visibility and fade-out (AC: #4)
  - [ ] Show component only when chat has only the greeting message (no user messages yet)
  - [ ] When `visible` becomes false (after first user message), play a 150ms fade-out animation
  - [ ] Set `aria-hidden="true"` on the starters container before removal when fading out after first message
  - [ ] Unmount component after fade-out completes
  - [ ] Clear any pending animation timers on component unmount to prevent memory leaks
- [ ] Ensure accessibility (AC: #1, #2)
  - [ ] All starter buttons are focusable (`<button>` elements)
  - [ ] Each button has descriptive accessible text (the starter message itself serves as the label)
  - [ ] Use `aria-label` (not `aria-labelledby`) for any ARIA references since widget is inside Shadow DOM

## Dev Notes

### Component Structure
- **File**: `apps/widget/src/components/ConversationStarters.tsx`
- **Props**: `{ starters: Array<{ message: string }>, onSelect: (message: string) => void, visible: boolean }`
- Preact component: use `class` attribute, import from `preact/hooks`

### Display Logic
- Show only when chat has only the greeting message (no user messages sent yet)
- Data source: `config.conversationStarters` -- max 4 items, each with a `.message` field (80-char max per Story 4-18)
- After the first user message, the component fades out (150ms) and unmounts

### Styling
- Layout: `display: flex`, `flex-wrap: wrap`, horizontal buttons wrapping to next line
- Button style: outlined pill shape, `--cw-color-primary` border, small padding
- Hover: background fills with `--cw-color-primary`, text becomes white
- Truncation: `text-overflow: ellipsis` for long starter text
- All styles in constructable stylesheet within Shadow DOM, `--cw-*` namespace

### Animation
- Fade-out: 150ms opacity transition when `visible` changes to false
- Can use CSS transition on opacity or a CSS animation

### Accessibility
- Buttons are native `<button>` elements (inherently focusable and keyboard-accessible)
- Button text is the starter message, providing a natural label
- Avoid `aria-labelledby` inside Shadow DOM; use `aria-label` if additional context is needed

### Project Structure Notes
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- CSS variables: `--cw-*` namespace

### References
- Agent config field: `conversationStarters[]` -- array of `{ message: string }` objects, max 4
- Story 4-18 defines the 80-char max per starter message
