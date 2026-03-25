# Story 5.5: Theme CSS Variables Injection

Status: ready-for-dev

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

- [ ] Task 1: Define theme property mapping (AC: 1)
  - [ ] Create `src/styles/theme.ts` with complete mapping from AgentTheme API fields to CSS variable names
  - [ ] Map all 50+ fields: headerBg → --cw-header-bg, headerTextColor → --cw-header-text, iconBg → --cw-icon-bg, iconBorderRadius → --cw-icon-radius, userBubbleBg → --cw-user-bubble-bg, botBubbleBg → --cw-bot-bubble-bg, fontFamily → --cw-font-family, etc.
  - [ ] Define default values for every CSS variable
  - [ ] Export mapping as a typed constant for type safety

- [ ] Task 2: Create theme engine service (AC: 1, 2, 3)
  - [ ] Create `src/services/theme-engine.ts`
  - [ ] Implement `applyTheme(hostElement: HTMLElement, themeConfig: Record<string, string>): void`
  - [ ] Iterate over theme mapping, set each variable on host element via `hostElement.style.setProperty('--cw-variable', value)`
  - [ ] For unmapped or missing properties, do not set (let CSS fallback handle it)

- [ ] Task 3: Add default variable declarations to theme stylesheet (AC: 3)
  - [ ] In the theme sheet (from 5-2's 3-sheet architecture), declare all `--cw-*` variables with defaults on `:host`
  - [ ] Ensure every component CSS rule uses `var(--cw-variable-name, fallback-value)` pattern
  - [ ] Document the full variable list for component authors

- [ ] Task 4: Implement value validation (AC: 5)
  - [ ] Create validation functions for different value types:
    - [ ] `isValidColor(value)`: validate hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla() with variable whitespace, named CSS colors via `CSS.supports('color', value)`, and special values `transparent` and `currentColor`
    - [ ] `isValidPixelValue(value)`: validate px, rem, em, % values
    - [ ] `isValidFontFamily(value)`: validate font family strings
  - [ ] On invalid value, log debug warning: `[CodeWeaves] Invalid theme value for {field}: {value}, using default`
  - [ ] Skip setting the CSS variable for invalid values (fallback in CSS handles it)

- [ ] Task 5: Implement preview mode with postMessage (AC: 4)
  - [ ] Add `window.addEventListener('message', handler)` for theme update messages
  - [ ] Accept messages with shape: `{ type: 'cw-theme-update', theme: Record<string, string> }`
  - [ ] Validate message origin: allow messages from `config.allowedDomains` and the widget's own origin only
  - [ ] Log warning for rejected messages from unauthorized origins: `[CodeWeaves] Rejected theme update from unauthorized origin: {origin}`
  - [ ] On valid theme update message, call `applyTheme()` with new values
  - [ ] Enable preview mode detection via `data-preview="true"` attribute on the script tag
  - [ ] Emit readiness handshake on load when `data-preview="true"`: post `{ type: 'cw-widget-ready' }` to parent so the dashboard knows the widget is listening

- [ ] Task 6: Integrate theme engine into widget initialization (AC: 1, 2)
  - [ ] After config-loader (Story 5-4) returns config, extract `config.theme`
  - [ ] Call `applyTheme(hostElement, config.theme)` to set initial theme
  - [ ] Ensure theme is applied before widget becomes visible (before opacity transition)

- [ ] Task 7: Write unit tests for theme engine (AC: 1, 2, 5)
  - [ ] Test: all theme properties are mapped to correct CSS variable names
  - [ ] Test: applyTheme sets CSS variables on host element
  - [ ] Test: invalid hex color values are rejected
  - [ ] Test: invalid pixel values are rejected
  - [ ] Test: missing theme properties use defaults
  - [ ] Test: postMessage theme updates are applied
  - [ ] Test: postMessage from unauthorized origin is rejected

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
