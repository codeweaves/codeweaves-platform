# Story 5-23: Widget UI Gaps — Branding Footer & Avatar Type Icons

Status: done

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
- [x] Add branding footer section below ChatInput in ChatWindow (AC: #1, #2, #3)
  - [x] Render conditionally based on `branding.enabled` theme property
  - [x] Display `textPrefix` text (e.g., "Powered by") followed by either logo or link
  - [x] When `branding.useLogo` is true: render `<img>` with `branding.logo` URL (max-height 16px)
  - [x] When `branding.useLogo` is false: render `<a>` with `branding.linkText` and `branding.linkUrl`
  - [x] Apply `branding.textColor` to prefix text, `branding.linkColor` to link
  - [x] Center-align footer, small font size (~11px), subtle styling
  - [x] Validate logo/link URLs with `isSafeUrl()` (https only, matching 5-8 pattern)
- [x] Add branding CSS to constructable stylesheet (AC: #1)
  - [x] `.cw-branding` footer styles using `--cw-*` CSS variables
  - [x] Link hover state with underline
  - [x] No extra padding that disrupts mobile fullscreen layout

### Avatar Type Icons
- [x] Replace letter-based avatars with SVG icon rendering (AC: #4, #5, #6, #7)
  - [x] Accept `botAvatarType` and `userAvatarType` props in MessageBubble
  - [x] Create inline SVG icons for each type (lightweight, no external library):
    - `robot` (default bot): simple robot/bot head SVG
    - `machine`: gear/cog SVG
    - `bot`: lightning/zap SVG
    - `support`: headphones SVG
    - `user`/`male` (default user): person silhouette SVG
    - `female`: person with checkmark SVG
    - `custom`: existing `<img>` with URL (already implemented)
  - [x] SVGs should be ~24x24px, use `currentColor` for fill so `--cw-avatar-*-color` CSS variable controls icon color
  - [x] Keep SVGs minimal (path-only) to minimize bundle impact
  - [x] Fallback: if type is unrecognized, render first letter as current behavior
- [x] Add `rounded` shape support to avatar CSS (AC: #6)
  - [x] Currently only `circle` and `square` — add `rounded` with `border-radius: 8px`
- [x] Pass avatar type from config through ChatWindow → MessageArea → MessageBubble (AC: #4, #5)
  - [x] Read `botAvatar.type` and `userAvatar.type` from theme config
  - [x] Thread through component props

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

## Senior Developer Review (AI)

- **Review Date**: 2026-03-28
- **Outcome**: Changes Requested
- **Reviewers**: Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings**: 7 (0 High, 4 Med, 3 Low) — 4 rejected as noise
- **Action Items**:
  - [x] Med — User avatar shape ignored (only botAvatar.shape read); split into per-side shapes
  - [x] Med — Branding logo `<img>` missing onError handler; added fallback
  - [x] Med — Branding footer renders empty "Powered by " with no content; hide when empty
  - [x] Med — isSafeUrl duplicated with different implementations; extracted shared utility (https-only)
  - [x] Low — dangerouslySetInnerHTML for SVG icons; replaced with safe Preact VNode rendering
  - [x] Low — SVG rendered at 20x20 vs spec ~24x24; adjusted to 22x22
  - [x] Low — Bad spec: isSafeUrl spec says "https only, matching 5-8 pattern" but 5-8 allows http+https; resolved as https-only per user decision

## Dev Agent Record

### Implementation Plan
- Created `BrandingFooter` component with all 8 branding properties, conditional rendering, URL safety validation
- Created `avatar-icons.ts` module with Preact VNode SVG icons for all 6 bot types and 3 user types (stroke-based, `currentColor`)
- Updated `Avatar` component to accept optional `icon` prop (priority: custom image → SVG icon → letter fallback)
- Added `rounded` avatar shape CSS class (`border-radius: 8px`)
- Threaded `botAvatarType`, `userAvatarType`, `botAvatarShape`, `userAvatarShape` through ChatWindow → MessageArea → MessageBubble → Avatar
- Updated `TypingIndicator` to also use avatar type icons
- Updated `extractChatConfig` to support `rounded` shape, extract avatar types, and read shape per-side
- Added branding footer CSS (`.cw-branding*`) to constructable stylesheet
- Extracted shared `isSafeUrl` utility to `utils/url.ts` (https-only)

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| 1 | Med | User avatar shape ignored — only `botAvatar.shape` was read | Split `avatarShape` into `botAvatarShape` + `userAvatarShape`, threaded through all components |
| 2 | Med | Branding logo `<img>` had no `onError` handler — broken image icon on 404 | Added `onError` + `logoFailed` state to hide broken image |
| 3 | Med | Branding footer rendered "Powered by " with empty content | Added guard: hide footer when no meaningful content (no logo, no link, no text) |
| 4 | Med | `isSafeUrl` duplicated in ChatHeader and BrandingFooter with different implementations | Extracted shared `isSafeUrl` to `utils/url.ts`, updated all consumers |
| 5 | Low | `dangerouslySetInnerHTML` used for SVG icon strings — XSS surface | Replaced with safe Preact `h()` VNode rendering, no raw HTML |
| 6 | Low | SVG rendered at 20x20 vs spec ~24x24 | Adjusted to 22x22 (appropriate within 32px avatar container) |

### Debug Log
- No issues encountered during initial implementation.
- Code review found 7 findings (4 rejected as noise), 6 fixed.

### Completion Notes
- All 7 acceptance criteria satisfied
- Lint, type-check, and build all pass
- No backend changes — frontend widget only (no test:cov needed per CLAUDE.md)
- Bundle impact minimal: ~2KB SVG VNode components + ~0.5KB branding component
- CSS variables `--cw-branding-text` and `--cw-branding-link` already existed in theme-map.ts
- Avatar CSS vars `--cw-avatar-*-bg` and `--cw-avatar-*-color` already existed — icons inherit via `currentColor`
- All URLs across widget now use consistent https-only validation via shared `isSafeUrl`

## File List
- `apps/widget/src/utils/url.ts` (new) — Shared `isSafeUrl` utility (https-only)
- `apps/widget/src/components/avatar-icons.ts` (new) — Preact VNode SVG icon definitions for all avatar types
- `apps/widget/src/components/BrandingFooter.tsx` (new) — Branding footer component with logo error handling
- `apps/widget/src/components/Avatar.tsx` (modified) — Added `icon` prop for safe VNode SVG rendering
- `apps/widget/src/components/MessageBubble.tsx` (modified) — Per-side avatar shape, avatar type icons
- `apps/widget/src/components/MessageArea.tsx` (modified) — Threading per-side avatar shapes and types
- `apps/widget/src/components/ChatWindow.tsx` (modified) — Branding config, per-side avatar shapes, shared isSafeUrl
- `apps/widget/src/components/ChatHeader.tsx` (modified) — Use shared isSafeUrl utility
- `apps/widget/src/components/TypingIndicator.tsx` (modified) — Avatar type icon support
- `apps/widget/src/styles/components.ts` (modified) — Branding footer CSS, rounded avatar shape CSS

## Change Log
- 2026-03-28: Implemented branding footer and avatar type icons (Story 5-23)
- 2026-03-28: Fixed 6 code review findings: per-side avatar shapes, logo error handling, empty content guard, shared isSafeUrl, safe VNode rendering, SVG size adjustment
