# Story 5.5: Theme CSS Variables Injection

Status: done

## Story

As a **website visitor**,
I want the widget to display with the configured theme,
So that it matches the brand I'm interacting with.

## Acceptance Criteria

1. **Given** an agent theme configuration with 50+ properties
   **When** the theme engine processes the configuration
   **Then** all theme properties are converted to CSS custom properties with the `--cw-*` namespace

2. **Given** the CSS variables have been generated
   **When** they are injected into the widget
   **Then** they are set on the shadow root's `:host` element

3. **Given** a widget component needs to reference theme values
   **When** the component uses CSS
   **Then** it references variables like `var(--cw-header-bg)` with appropriate fallbacks

4. **Given** the widget is in preview mode (dashboard live preview)
   **When** the theme configuration changes
   **Then** theme changes apply immediately without page reload

5. **Given** the API returns an invalid color value for a theme property
   **When** the theme engine processes the configuration
   **Then** the invalid value is skipped and the default fallback is used

## Tasks / Subtasks

- [x] Task 1: Define theme property mapping (AC: 1)
  - [x] Create `src/styles/theme-map.ts` with complete mapping from WidgetTheme API fields to CSS variable names
  - [x] Map all fields using dot-notation keys matching nested WidgetTheme structure (icon.backgroundColor → --cw-icon-bg, header.textColor → --cw-header-text, etc.)
  - [x] Define default values for every CSS variable (aligned with packages/validation/src/theme.ts defaults)
  - [x] Export mapping as typed constant with ThemeMapEntry interface for type safety

- [x] Task 2: Create theme engine service (AC: 1, 2, 3)
  - [x] Create `src/services/theme-engine.ts`
  - [x] Implement `applyTheme(hostElement: HTMLElement, themeConfig: Record<string, unknown>): void`
  - [x] Resolve nested dot-notation paths from WidgetTheme, set each variable on host element via `hostElement.style.setProperty()`
  - [x] For unmapped or missing properties, skip (let CSS fallback handle it)
  - [x] Implement `clearTheme()` for resetting to defaults

- [x] Task 3: Add default variable declarations to theme stylesheet (AC: 3)
  - [x] Updated `src/styles/theme.ts` to generate `:host` block from THEME_MAP defaults programmatically
  - [x] Added derived alias variables (--cw-trigger-bg, --cw-primary, etc.) referencing theme map vars
  - [x] Component CSS rules use `var(--cw-variable-name, fallback-value)` pattern

- [x] Task 4: Implement value validation (AC: 5)
  - [x] `isValidColor(value)`: validates hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla(), named CSS colors via `CSS.supports('color', value)`, and special values (transparent, currentColor)
  - [x] `isValidSize(value)`: validates px, rem, em, %, vh, vw values
  - [x] `isValidFontFamily(value)`: validates font family strings, rejects CSS injection attempts
  - [x] Numeric API values auto-converted: number-px (56 → '56px'), number-pct (50 → '50%'), number-ms (200 → '200ms')
  - [x] On invalid value, log debug warning: `[CodeWeaves] Invalid theme value for {field}: {value}, using default`
  - [x] Invalid values: removeProperty so CSS default takes over

- [x] Task 5: Implement preview mode with postMessage (AC: 4)
  - [x] `setupPreviewMode()` adds message listener for `{ type: 'cw-theme-update', theme: {...} }` messages
  - [x] Origin validation: allowed origins from config.allowedDomains + same origin
  - [x] Warning logged for rejected origins: `Rejected theme update from unauthorized origin: {origin}`
  - [x] Preview mode activated only when `data-preview="true"` on script tag
  - [x] Readiness handshake: posts `{ type: 'cw-widget-ready' }` to parent on load
  - [x] `teardownPreviewMode()` cleans up listener on destroy

- [x] Task 6: Integrate theme engine into widget initialization (AC: 1, 2)
  - [x] Widget.tsx receives `hostElement` prop from main.tsx
  - [x] After config loads, calls `applyTheme(hostElement, config.theme)` before `revealWidget()`
  - [x] Calls `setupPreviewMode()` with allowed domains
  - [x] Cleanup: `teardownPreviewMode()` in useEffect cleanup

- [x] Task 7: Write unit tests for theme engine (AC: 1, 2, 5)
  - [x] SKIPPED: Widget app has no test framework. Per project rules, frontend apps (apps/web, apps/widget) use manual testing only — no unit tests.

## Dev Notes

### Theme Property Mapping

Complete mapping from AgentTheme API response fields to CSS custom properties:

```typescript
// src/styles/theme.ts
export const THEME_MAP: Record<string, { variable: string; default: string; type: 'color' | 'size' | 'font' | 'string' }> = {
  // Header
  headerBg:           { variable: '--cw-header-bg',          default: '#007bff', type: 'color' },
  headerTextColor:    { variable: '--cw-header-text',        default: '#ffffff', type: 'color' },
  headerHeight:       { variable: '--cw-header-height',      default: '56px',    type: 'size' },

  // Icon / Launcher
  iconBg:             { variable: '--cw-icon-bg',            default: '#007bff', type: 'color' },
  iconColor:          { variable: '--cw-icon-color',         default: '#ffffff', type: 'color' },
  iconBorderRadius:   { variable: '--cw-icon-radius',        default: '50%',     type: 'size' },
  iconSize:           { variable: '--cw-icon-size',          default: '56px',    type: 'size' },
  iconShadow:         { variable: '--cw-icon-shadow',        default: '0 4px 12px rgba(0,0,0,0.15)', type: 'string' },

  // Chat bubbles
  userBubbleBg:       { variable: '--cw-user-bubble-bg',     default: '#007bff', type: 'color' },
  userBubbleText:     { variable: '--cw-user-bubble-text',   default: '#ffffff', type: 'color' },
  botBubbleBg:        { variable: '--cw-bot-bubble-bg',      default: '#f1f3f5', type: 'color' },
  botBubbleText:      { variable: '--cw-bot-bubble-text',    default: '#212529', type: 'color' },
  bubbleBorderRadius: { variable: '--cw-bubble-radius',      default: '12px',    type: 'size' },

  // Typography
  fontFamily:         { variable: '--cw-font-family',        default: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', type: 'font' },
  fontSize:           { variable: '--cw-font-size',          default: '14px',    type: 'size' },

  // Widget container
  widgetWidth:        { variable: '--cw-widget-width',       default: '380px',   type: 'size' },
  widgetHeight:       { variable: '--cw-widget-height',      default: '600px',   type: 'size' },
  widgetBorderRadius: { variable: '--cw-widget-radius',      default: '12px',    type: 'size' },
  widgetShadow:       { variable: '--cw-widget-shadow',      default: '0 8px 32px rgba(0,0,0,0.12)', type: 'string' },
  widgetBg:           { variable: '--cw-widget-bg',          default: '#ffffff', type: 'color' },

  // Input area
  inputBg:            { variable: '--cw-input-bg',           default: '#ffffff', type: 'color' },
  inputBorder:        { variable: '--cw-input-border',       default: '#dee2e6', type: 'color' },
  inputText:          { variable: '--cw-input-text',         default: '#212529', type: 'color' },
  inputPlaceholder:   { variable: '--cw-input-placeholder',  default: '#868e96', type: 'color' },

  // ... (remaining 30+ fields follow the same pattern)
};
```

### CSS Variable Usage in Components

All widget components reference CSS variables with fallbacks:

```css
/* Example: header component styles */
.cw-header {
  background: var(--cw-header-bg, #007bff);
  color: var(--cw-header-text, #ffffff);
  height: var(--cw-header-height, 56px);
  font-family: var(--cw-font-family, sans-serif);
}

.cw-bubble--user {
  background: var(--cw-user-bubble-bg, #007bff);
  color: var(--cw-user-bubble-text, #ffffff);
  border-radius: var(--cw-bubble-radius, 12px);
}
```

### Dynamic Theme Update via postMessage

For the dashboard live preview, theme updates are sent via postMessage:

```typescript
// Dashboard sends:
iframe.contentWindow.postMessage({
  type: 'cw-theme-update',
  theme: { headerBg: '#ff0000', userBubbleBg: '#00ff00', ... }
}, widgetOrigin);

// Widget listens:
window.addEventListener('message', (event) => {
  if (event.data?.type === 'cw-theme-update') {
    applyTheme(hostElement, event.data.theme);
  }
});
```

### Validation Logic

```typescript
const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_REGEX = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/;
const SIZE_REGEX = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/;

function isValidColor(value: string): boolean {
  return HEX_REGEX.test(value) || RGB_REGEX.test(value) || CSS.supports('color', value);
}
```

### Theme File Ownership

- **Story 5-1** creates the default CSS variable declarations in `styles/theme.ts` (the static THEME_MAP constant with default values)
- **Story 5-5** creates the runtime theme engine service (`services/theme-engine.ts`) that maps API AgentTheme config to `--cw-*` CSS variables dynamically at load time and during preview updates

### 3-Sheet Architecture Integration

From Story 5-2, the widget uses three constructable stylesheets:
1. **Reset sheet** — normalize styles within shadow DOM
2. **Theme sheet** — default CSS variable declarations (`:host { --cw-header-bg: #007bff; ... }`)
3. **Component sheet** — component styles referencing CSS variables

This story primarily affects the **theme sheet** (default declarations) and the runtime variable injection on the `:host` element. Runtime values set via `style.setProperty()` on the host element take precedence over the defaults in the theme sheet.

### Project Structure Notes

```
apps/widget/src/
  services/
    theme-engine.ts     ← This story (applyTheme, preview mode listener)
  styles/
    theme.ts            ← This story (THEME_MAP constant, defaults, validation)
    reset.css           ← From Story 5-2
    theme.css           ← From Story 5-2 (default variable declarations)
    components.css      ← Component styles using var(--cw-*)
```

### References

- Story 5-2: Shadow DOM with constructable stylesheets and 3-sheet architecture
- Story 5-4: Config loader provides `config.theme` to theme engine
- `docs/research-widget-css-isolation.md` Section 6: CSS custom properties strategy
- AgentTheme model: `apps/api/prisma/schema.prisma` — 50+ theme fields

## Dev Agent Record

### Implementation Plan

1. Created `theme-map.ts` with complete dot-notation mapping from nested WidgetTheme API response to flat --cw-* CSS variables
2. Created `theme-engine.ts` service with applyTheme(), clearTheme(), validation (color/size/font/numeric types), and preview mode via postMessage
3. Updated `theme.ts` to generate :host defaults from THEME_MAP programmatically, plus derived alias variables for backward compatibility
4. Integrated into Widget.tsx: host element passed as prop, theme applied after config load but before reveal, preview mode setup with cleanup

### Debug Log

- Aligned THEME_MAP defaults with `packages/validation/src/theme.ts` defaultWidgetTheme values (e.g. #3b82f6 not #007bff)
- API returns nested WidgetTheme (e.g. `{ icon: { backgroundColor: '#f00' } }`), so mapping uses dot-notation keys resolved via `resolveNested()`
- Numeric fields (size, borderRadius, transitionDuration) sent as numbers from API, auto-converted to CSS units via number-px/number-pct/number-ms types
- Task 7 (unit tests) skipped — widget app has no test framework per project rules (no frontend unit tests)

### Completion Notes

- All 6 implementation tasks completed, 1 skipped (tests — per project rules)
- Type check, lint, and build all pass
- Widget bundle: 30.61 kB (11.01 kB gzip) — minimal size increase
- Theme is applied before revealWidget() preventing any flash of unthemed content

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | High | `previewListener` singleton leak on double `setupPreviewMode` call | Call `teardownPreviewMode()` at start of `setupPreviewMode` |
| P2 | High | `Infinity` and negative values pass numeric validation | Added `strictParseNumber()` with `isFinite` check and `num < 0` rejection |
| P3 | High | `--cw-bubble-fg` used in components.ts but never declared | Added `--cw-bubble-fg: var(--cw-bubble-text, #1f2937)` alias in theme.ts |
| P4 | Med | `parseFloat` silently accepts trailing garbage (`"42abc"` → 42) | Replaced with strict regex + `Number()` parsing |
| P5 | Med | `postMessage` readiness handshake uses wildcard `*` origin | Send to each allowed origin specifically |
| P6 | Low | `isValidFontFamily` allows `;` and `:` characters | Added `;:` and `expression()/url()` rejection |
| P7 | Low | `string` type values have no sanitization | Reject `expression()`, `url()`, `{}<>` patterns |
| D1 | Low | Component CSS `var()` calls lack inline fallbacks (AC3 deviation) | Added fallback values to all `var()` calls in components.ts |
| D2 | Low | RGB/HSL regex rejects CSS Color Level 4 space-separated syntax | Updated regexes to accept `rgb(59 130 246)` format |
| D3 | Low | `number-pct` type silently converts `"16px"` → `"16%"` | `strictParseNumber` rejects strings with unit suffixes |

## Senior Developer Review (AI)

**Review Date:** 2026-03-25
**Review Outcome:** Changes Requested
**Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3-layer parallel adversarial review)
**Total Findings:** 17 raw → 10 actionable after dedup/triage (7 patch, 3 defer, 6 rejected as noise)

### Action Items

- [x] **[High]** `previewListener` singleton leak — double `setupPreviewMode` call overwrites listener, making first un-removable. Added `teardownPreviewMode()` at start of `setupPreviewMode`.
- [x] **[High]** `Infinity` and negative values pass numeric validation — `parseFloat("Infinity")` not NaN, produces `Infinitypx`. Added `strictParseNumber()` with `isFinite` + negative rejection.
- [x] **[High]** `--cw-bubble-fg` undefined — `components.ts` uses `var(--cw-bubble-fg)` but THEME_MAP declares `--cw-bubble-text`. Added alias `--cw-bubble-fg: var(--cw-bubble-text, #1f2937)` in theme.ts.
- [x] **[Med]** `parseFloat` accepts trailing garbage — `"42abc"` → 42 silently. Replaced with strict regex + `Number()` parsing.
- [x] **[Med]** `postMessage` readiness handshake uses wildcard `*` origin — leaks widget presence. Now sends to each allowed origin specifically.
- [x] **[Low]** `isValidFontFamily` too permissive — only rejected `{}`. Added `;:` and `expression()/url()` rejection.
- [x] **[Low]** `string` type values unsanitized — added rejection of `expression()`, `url()`, `{}<>` patterns.
- [x] **[Deferred→Fixed]** Component CSS `var()` calls lack inline fallbacks (AC3 deviation from Story 5-2) — added fallback values to all `var()` calls in components.ts.
- [x] **[Deferred→Fixed]** RGB/HSL regex rejects CSS Color Level 4 space-separated syntax — updated regexes to accept `rgb(59 130 246)` format.
- [x] **[Deferred→Fixed]** `number-pct` type silently converts `"16px"` → `"16%"` — `strictParseNumber` now rejects strings with unit suffixes.

## File List

- `apps/widget/src/styles/theme-map.ts` — NEW: Complete THEME_MAP constant mapping WidgetTheme API fields to CSS variables
- `apps/widget/src/styles/theme.ts` — MODIFIED: Generates :host defaults from THEME_MAP, adds derived alias variables
- `apps/widget/src/services/theme-engine.ts` — NEW: Theme engine service (applyTheme, clearTheme, validation, preview mode)
- `apps/widget/src/components/Widget.tsx` — MODIFIED: Added hostElement prop, theme application on config load, preview mode setup/teardown
- `apps/widget/src/main.tsx` — MODIFIED: Pass host element from initShadowDom() to Widget component
- `apps/widget/src/styles/components.ts` — MODIFIED: Added inline fallbacks to all var() calls (D1 review fix)

## Change Log

- 2026-03-25: Implemented theme CSS variables injection — theme-map, theme-engine service, validation, preview mode, widget integration
- 2026-03-25: Code review fixes — 7 patches + 3 deferred issues resolved:
  - P1: Fixed previewListener singleton leak (teardown before setup)
  - P2: Added Infinity/negative bounds checking for numeric values
  - P3: Added missing --cw-bubble-fg alias in theme.ts
  - P4: Replaced parseFloat with strict numeric parsing (rejects trailing garbage)
  - P5: Replaced postMessage wildcard '*' with specific allowed origins
  - P6: Hardened isValidFontFamily — rejects semicolons, colons, expression(), url()
  - P7: Added string type sanitization — rejects expression(), url(), angle brackets
  - D1: Added inline fallbacks to all var() calls in components.ts
  - D2: Updated RGB/HSL regexes to accept CSS Color Level 4 space-separated syntax
  - D3: strictParseNumber now rejects string-with-unit values (e.g. "16px" → null)
