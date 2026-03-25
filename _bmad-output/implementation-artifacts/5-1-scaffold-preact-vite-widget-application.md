# Story 5.1: Scaffold Preact + Vite Widget Application

Status: ready-for-dev

## Story

As a **developer**,
I want a Preact + Vite application scaffold in `apps/widget`,
so that I can build the embeddable chat widget with optimal bundle size.

## Acceptance Criteria

1. `apps/widget` contains Vite + Preact configuration
2. TypeScript strict mode is enabled
3. Build output targets ES2020 for modern browsers
4. `bun run build` produces production bundle (IIFE format)
5. Bundle analyzer is configured for size monitoring

## Tasks / Subtasks

- [ ] Task 1: Restructure `apps/widget/src/` directory layout (AC: 1)
  - [ ] Create `src/components/` directory with stub components: `Widget.tsx`, `ChatWindow.tsx`, `TriggerButton.tsx`, `BubbleNotification.tsx`
  - [ ] Create `src/services/` directory (empty, for future API client and config loader)
  - [ ] Create `src/hooks/` directory (empty, for future Preact hooks)
  - [ ] Create `src/styles/` directory with `reset.ts`, `theme.ts`, `components.ts` (CSS string exports)
  - [ ] Create `src/utils/` directory (empty, for future helpers)
  - [ ] Create `src/types/` directory with initial TypeScript interfaces
  - [ ] Create `src/shadow-dom.ts` (stub — full implementation in Story 5-2)
  - [ ] Restructure `src/main.tsx` as IIFE auto-init entry point

- [ ] Task 2: Update Vite configuration for production IIFE output (AC: 1, 3, 4)
  - [ ] Set `build.target` to `es2020`
  - [ ] Set `build.lib` with IIFE format and `inlineDynamicImports: true`
  - [ ] Set global name for IIFE (e.g., `CodeWeavesWidget`)
  - [ ] Disable source maps in production (`build.sourcemap: false`)
  - [ ] Configure output filename pattern (e.g., `codeweaves-widget.js`)
  - [ ] Ensure CSS is inlined (no separate CSS file — styles are in constructable stylesheets)
  - [ ] **Dev note — CSS-as-JS-strings strategy:** CSS files are replaced by JS-exported style strings that become constructable `CSSStyleSheet` objects at runtime. This is CSP-safe because no inline `<style>` tags are injected. See research Section 7 for full rationale.

- [ ] Task 3: Enable TypeScript strict mode (AC: 2)
  - [ ] Update `tsconfig.json` with `"strict": true`
  - [ ] Verify all strict flags are active: `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitAny`, `noImplicitThis`
  - [ ] Fix any type errors introduced by strict mode in existing files

- [ ] Task 4: Configure bundle analyzer (AC: 5)
  - [ ] Install `rollup-plugin-visualizer` as dev dependency
  - [ ] Add visualizer plugin to Vite config (gzip + brotli size reporting)
  - [ ] Configure to output `stats.html` in build directory
  - [ ] Add `stats.html` to `.gitignore`

- [ ] Task 5: Create stub components (AC: 1)
  - [ ] `Widget.tsx` — main widget container, renders TriggerButton and conditionally renders ChatWindow
  - [ ] `ChatWindow.tsx` — placeholder chat window with basic open/close state
  - [ ] `TriggerButton.tsx` — floating trigger button stub
  - [ ] `BubbleNotification.tsx` — greeting bubble notification stub
  - [ ] All components use Preact's `class` attribute (not `className`)

- [ ] Task 6: Create initial style modules (AC: 1)
  - [ ] `styles/reset.ts` — export CSS reset string (`:host { all: initial; ... }`)
    - [ ] Include `direction: inherit` and `writing-mode: inherit` on `:host` for RTL/vertical text support
    - [ ] Include `*, *::before, *::after { box-sizing: border-box }` cascade rule
  - [ ] `styles/theme.ts` — export CSS custom properties with `--cw-*` namespace and default values
  - [ ] `styles/components.ts` — export component CSS strings (minimal stubs)

- [ ] Task 7: Validate build output (AC: 3, 4, 5)
  - [ ] Run `bun run build` and verify single IIFE JS file is produced
  - [ ] Verify output targets ES2020 syntax (no downlevel transforms below ES2020)
  - [ ] Verify no source maps are generated
  - [ ] Verify bundle analyzer output is generated

## Dev Notes

### Story 0-12 Already Scaffolded the Basic App

This story does NOT create `apps/widget` from scratch. Story 0-12 already scaffolded it with:
- `package.json` (Preact 10.26.0, Vite 6.3.0, @preact/preset-vite 2.10.0)
- `vite.config.ts` (basic dev config)
- `main.tsx` (renders to `#codeweaves-widget-root`)
- `App.tsx` (simple toggle button + chat skeleton)

This story **restructures** the existing app into proper production structure. The current `App.tsx` and `main.tsx` content will be replaced/reorganized.

### Target Directory Structure

```
apps/widget/src/
├── components/          # Preact components
│   ├── Widget.tsx       # Main widget container
│   ├── ChatWindow.tsx   # Chat window (stub)
│   ├── TriggerButton.tsx # Floating trigger (stub)
│   └── BubbleNotification.tsx # Greeting bubble (stub)
├── services/            # API client, config loader
├── hooks/               # Preact hooks
├── styles/              # CSS strings for constructable stylesheets
│   ├── reset.ts         # CSS reset string
│   ├── theme.ts         # Theme variable defaults
│   └── components.ts    # Component styles
├── utils/               # Helpers
├── types/               # TypeScript interfaces
├── shadow-dom.ts        # Shadow DOM initialization (stub — Story 5-2)
└── main.tsx             # Entry point (IIFE auto-init)
```

### Vite Config — IIFE Output

The widget must ship as a single IIFE file that website owners drop into a `<script>` tag. Key Vite/Rollup settings:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    preact(),
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        name: 'CodeWeavesWidget',
        entryFileNames: 'codeweaves-widget.js',
        inlineDynamicImports: true,
      },
    },
    // No CSS file output — styles are in constructable stylesheets as JS strings
    cssCodeSplit: false,
  },
});
```

### Theme File Ownership

Story 5-1 creates `styles/theme.ts` with **default** CSS variable declarations (the `--cw-*` custom properties with hardcoded default values). Story 5-5 creates the **runtime theme engine** that maps API-fetched agent configuration (`AgentTheme` model) to CSS variables dynamically, overriding these defaults at runtime.

### Preact — NOT React

The widget app uses **Preact**, not React. Key differences:
- Use `class` instead of `className` in JSX
- ESLint rule `react/no-unknown-property: ["error", { ignore: ["class"] }]` is already configured
- Import from `preact` and `preact/hooks`, not `react`
- Preact uses direct event listeners (not document-level delegation) — this is important for Shadow DOM compatibility (Story 5-2)

### Style Modules — CSS as JS Strings

Styles are NOT imported as CSS files. They are TypeScript modules exporting CSS strings, which will be used with constructable stylesheets (`new CSSStyleSheet()`) in Story 5-2:

```typescript
// styles/reset.ts
export const resetCSS = `
:host {
  all: initial;
  display: block;
  box-sizing: border-box;
  visibility: visible;
}
*, *::before, *::after {
  box-sizing: border-box;
}
`;
```

### Theme Variables — --cw-* Namespace

All CSS custom properties use `--cw-` prefix to avoid conflicts with host page variables. The theme system supports 50+ configurable properties from the `AgentTheme` database model:

```typescript
// styles/theme.ts
export const themeCSS = `
:host {
  --cw-primary: #6366f1;
  --cw-primary-foreground: #ffffff;
  --cw-background: #ffffff;
  --cw-foreground: #0f172a;
  --cw-border: #e2e8f0;
  --cw-radius: 0.5rem;
  --cw-font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --cw-font-size: 14px;
  /* ... 40+ more properties ... */
}
`;
```

### Entry Point — IIFE Auto-Init

```typescript
// main.tsx
// When the script loads, it immediately initializes the widget.
// The IIFE wrapper is handled by Vite/Rollup build output.
(function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

function bootstrap() {
  // Story 5-2 will implement Shadow DOM initialization here
  // For now, just create host element and render Widget directly
}
```

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/widget/src/main.tsx` | MODIFY — restructure as IIFE auto-init entry point |
| `apps/widget/src/App.tsx` | DELETE — replaced by `components/Widget.tsx` |
| `apps/widget/vite.config.ts` | MODIFY — IIFE output, ES2020 target, bundle analyzer |
| `apps/widget/tsconfig.json` | MODIFY — strict mode |
| `apps/widget/src/components/Widget.tsx` | CREATE — main widget container |
| `apps/widget/src/components/ChatWindow.tsx` | CREATE — chat window stub |
| `apps/widget/src/components/TriggerButton.tsx` | CREATE — trigger button stub |
| `apps/widget/src/components/BubbleNotification.tsx` | CREATE — greeting bubble stub |
| `apps/widget/src/styles/reset.ts` | CREATE — CSS reset string |
| `apps/widget/src/styles/theme.ts` | CREATE — theme variable defaults |
| `apps/widget/src/styles/components.ts` | CREATE — component CSS strings |
| `apps/widget/src/shadow-dom.ts` | CREATE — stub for Story 5-2 |
| `apps/widget/src/types/` | CREATE — TypeScript interfaces |

### References

- [Source: docs/research-widget-css-isolation.md] — Architecture decisions for CSS isolation, constructable stylesheets, Shadow DOM
- [Source: apps/widget/package.json] — Existing Preact + Vite dependencies (Story 0-12)
- [Source: epics.md] — Epic 5 overview and story definitions
