# Story 5-23: Widget UI Gaps — Branding Footer & Avatar Type Icons

Status: ready-for-dev

## Story
As a **website visitor**, I want the embedded chat widget to display the branding footer and correct avatar type icons, so that the widget matches the preview shown in the agent editor.

## Background
Stories 5-8 and 5-9 are implemented but have two functional gaps where the agent editor preview supports features that the widget does not render:
1. **Branding footer** — The preview renders it, the editor exposes all 8 branding properties, but the widget has no branding footer at all.
2. **Avatar type icons** — The schema defines 6 bot types (`robot`, `machine`, `bot`, `support`, `custom`, `user`) and 3 user types (`male`, `female`, `custom`). The preview renders distinct Lucide icons per type. But the widget only renders a first letter ("U"/"A") or a custom image URL.

## Acceptance Criteria
1. Widget renders branding footer below the chat input area matching the preview
2. Branding footer respects all 8 theme properties: `enabled`, `textPrefix`, `useLogo`, `logo`, `linkText`, `linkUrl`, `textColor`, `linkColor`
3. Branding footer is hidden when `branding.enabled` is false
4. Bot avatar renders correct icon per `botAvatar.type`: `robot` (bot icon), `machine` (gear icon), `bot` (zap icon), `support` (headphones icon), `custom` (image), `user` (user icon)
5. User avatar renders correct icon per `userAvatar.type`: `male`/`user` (user icon), `female` (user-check icon), `custom` (image)
6. Avatar shape (`circle`, `square`, `rounded`) applies correctly to all avatar types
7. Avatar background color and icon color use `--cw-avatar-*` CSS variables

## Tasks / Subtasks

### Branding Footer
- [ ] Add branding footer section below ChatInput in ChatWindow (AC: #1, #2, #3)
  - [ ] Render conditionally based on `branding.enabled` theme property
  - [ ] Display `textPrefix` text (e.g., "Powered by") followed by either logo or link
  - [ ] When `branding.useLogo` is true: render `<img>` with `branding.logo` URL (max-height 16px)
  - [ ] When `branding.useLogo` is false: render `<a>` with `branding.linkText` and `branding.linkUrl`
  - [ ] Apply `branding.textColor` to prefix text, `branding.linkColor` to link
  - [ ] Center-align footer, small font size (~11px), subtle styling
  - [ ] Validate logo/link URLs with `isSafeUrl()` (https only, matching 5-8 pattern)
- [ ] Add branding CSS to constructable stylesheet (AC: #1)
  - [ ] `.cw-branding` footer styles using `--cw-*` CSS variables
  - [ ] Link hover state with underline
  - [ ] No extra padding that disrupts mobile fullscreen layout

### Avatar Type Icons
- [ ] Replace letter-based avatars with SVG icon rendering (AC: #4, #5, #6, #7)
  - [ ] Accept `botAvatarType` and `userAvatarType` props in MessageBubble
  - [ ] Create inline SVG icons for each type (lightweight, no external library):
    - `robot` (default bot): simple robot/bot head SVG
    - `machine`: gear/cog SVG
    - `bot`: lightning/zap SVG
    - `support`: headphones SVG
    - `user`/`male` (default user): person silhouette SVG
    - `female`: person with checkmark SVG
    - `custom`: existing `<img>` with URL (already implemented)
  - [ ] SVGs should be ~24x24px, use `currentColor` for fill so `--cw-avatar-*-color` CSS variable controls icon color
  - [ ] Keep SVGs minimal (path-only) to minimize bundle impact
  - [ ] Fallback: if type is unrecognized, render first letter as current behavior
- [ ] Add `rounded` shape support to avatar CSS (AC: #6)
  - [ ] Currently only `circle` and `square` — add `rounded` with `border-radius: 8px`
- [ ] Pass avatar type from config through ChatWindow → MessageArea → MessageBubble (AC: #4, #5)
  - [ ] Read `botAvatar.type` and `userAvatar.type` from theme config
  - [ ] Thread through component props

## Dev Notes

### Branding Footer Reference
The preview renders branding in `chat-widget-surface.tsx` lines 539-570:
```
[textPrefix] [logo or linkText]
```
- Footer sits below the input area, above the bottom edge of the chat window
- Only visible when `branding.enabled` is true

### Avatar Icon Reference
The preview renders icons via Lucide React components in `chat-widget-surface.tsx` lines 96-139:
- Bot: `Bot` (robot), `SettingsIcon` (machine), `Zap` (bot), `Headphones` (support)
- User: `UserIcon` (male/default), `UserCheck` (female)

Since the widget uses Preact (not React) and can't use Lucide React, use inline SVG paths instead. Keep them simple — these are small 24x24 icons inside 32px avatar circles.

### CSS Variables (already mapped in theme-map.ts)
Branding likely needs new CSS variables or direct style injection. Check if `--cw-branding-*` variables exist in theme-map.ts; if not, add them.

Avatar variables already exist:
- `--cw-avatar-bot-bg`, `--cw-avatar-bot-color`
- `--cw-avatar-user-bg`, `--cw-avatar-user-color`

### Bundle Impact
- Inline SVG paths: ~1-2KB total (6 simple icons)
- Branding footer: ~0.5KB component code
- Negligible impact on widget bundle

---

## Deferred: Schema Properties Not Yet Exposed in Editor

The following 10 properties exist in the theme validation schema (`packages/validation/src/theme.ts`) but are **not exposed** in the agent editor UI and **not used** in the preview. These should be addressed in a future story — either add editor controls or remove from schema:

| # | Schema Property | Schema Default | Notes |
|---|----------------|---------------|-------|
| 1 | `icon.hoverBackgroundColor` | — | Hover state for trigger button |
| 2 | `icon.size` | 40-80px range | Preview hardcodes 56px |
| 3 | `icon.shadow` | CSS string | Preview uses it but no editor control |
| 4 | `icon.customImageUrl` | optional URL | Preview renders it but no upload UI in appearance-settings |
| 5 | `input.placeholderColor` | color string | Separate from input text color |
| 6 | `input.borderColor` | color string | Always default gray |
| 7 | `sendButton.hoverBackgroundColor` | — | Hover state for send button |
| 8 | `timestamps.format` | `'12h'` \| `'24h'` | Neither editor nor preview uses it |
| 9 | `animations.transitionDuration` | 0-1000ms | Neither editor nor preview uses it |
| 10 | `header.showLogo` | boolean | Implied by logoUrl presence, no explicit toggle |

**Decision**: Deferred. When implementing these, the work spans three layers:
1. Add UI controls in agent editor sections
2. Use the property in the preview component
3. Map to CSS variable / use in widget

These are cosmetic/polish customizations and don't block widget functionality.
