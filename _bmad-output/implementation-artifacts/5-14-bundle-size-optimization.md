# Story 5-14: Bundle Size Optimization

Status: ready-for-dev

## Story

As a **website owner**, I want the widget bundle to be under 150KB, so that it doesn't slow down my website.

## Acceptance Criteria

1. Total gzipped size is under 150KB (NFR10)
2. Main chunk is under 100KB
3. No unused code is included (tree-shaking verified)
4. Preact is used instead of React
5. Bundle analyzer report is generated

## Tasks / Subtasks

- [ ] Run baseline bundle size measurement (AC: #1, #2)
  - [ ] Run `bun run build` in apps/widget
  - [ ] Record dist/widget.js raw size and gzipped size
  - [ ] Document baseline numbers for comparison
- [ ] Generate bundle analyzer report (AC: #5)
  - [ ] Add `rollup-plugin-visualizer` to widget dev dependencies
  - [ ] Configure visualizer in Vite/Rollup config to output treemap HTML
  - [ ] Generate report and review for unexpected large modules
- [ ] Verify Preact usage and no React leakage (AC: #4)
  - [ ] Confirm bundle does not contain react or react-dom
  - [ ] Verify Preact aliases are correctly configured in build
  - [ ] Check only needed preact/hooks imports are included
- [ ] Verify tree-shaking effectiveness (AC: #3)
  - [ ] Review bundle analyzer treemap for unused exports
  - [ ] Ensure no dead code paths are included
  - [ ] Verify no dev-only code in production build (console.log removed by Terser)
- [ ] Apply optimizations if over budget (AC: #1, #2)
  - [ ] Verify inline SVGs are used for icons (no icon library bundled)
  - [ ] Verify CSS is in constructable stylesheets as strings (no CSS-in-JS runtime)
  - [ ] Verify no date library is bundled (use Intl.DateTimeFormat for timestamps)
  - [ ] Verify no markdown parser is bundled (plain text with minimal HTML sanitization)
  - [ ] Implement 2-phase lazy loading pattern:
    - Phase 1 (~2-3KB): Trigger button only — loads on page load
    - Phase 2 (~40-80KB): Full chat widget — loads on first click via `await import('./widget-full')`
    - This means initial page load cost is only 2-3KB
  - [ ] Review and tune Terser config:
    - `drop_console: true` removes all console.log/warn/error in production
    - `drop_debugger: true` removes debugger statements
    - Configuration lives in `apps/widget/vite.config.ts` under `build.terserOptions`
- [ ] Add bundle size CI check (AC: #1)
  - [ ] Add size check to build script: fail if gzipped output exceeds 150KB
  - [ ] Store bundle size in build output for tracking over time

## Dev Notes

### Execution Order

This is the **final story in Epic 5** — run after all other stories are complete. This story is about verification and optimization, not new features. All widget functionality should already be implemented.

### Verification Process

1. Run `bun run build` in `apps/widget`
2. Check `dist/widget.js` size (raw and gzipped)
3. Generate bundle analyzer report with `rollup-plugin-visualizer`
4. Verify Preact is used (not React) — check for `react`/`react-dom` in bundle
5. Verify tree-shaking: no unused exports in bundle
6. Verify no dev-only code in production (`console.log` removed by Terser)

### Optimization Techniques (if over budget)

| Technique | Detail |
|-----------|--------|
| Inline SVGs | Use inline SVGs for icons instead of an icon library |
| CSS as strings | Constructable stylesheets, no CSS-in-JS runtime |
| Preact not React | ~4KB vs ~40KB gzipped |
| No date library | Use `Intl.DateTimeFormat` for timestamps |
| No markdown parser | Plain text with minimal HTML sanitization |
| Lazy loading | 2-phase: tiny trigger loader (~2-3KB) loads full widget on first click via `await import('./widget-full')` |
| Terser config | `drop_console: true`, `drop_debugger: true` in `apps/widget/vite.config.ts` under `build.terserOptions` |
| Selective imports | Only import needed exports from `preact/hooks` |

### Bundle Size Budget

| Component | Budget |
|-----------|--------|
| Preact runtime | ~4KB gzip |
| Shadow DOM + init | ~2KB gzip |
| Theme engine | ~3KB gzip |
| UI components | ~25-35KB gzip |
| API/streaming client | ~5-8KB gzip |
| **Total** | **~40-55KB gzip** |

- 150KB gzipped is the hard NFR10 ceiling (must not exceed)
- 40-55KB gzipped is the realistic target based on the component breakdown above
- Anything in the 40-80KB range is excellent

### Font Loading
- Custom fonts must NOT be bundled in the widget JS
- They are loaded from light DOM at runtime (Story 5-2)
- System font stack is the zero-cost default

### Tools

- `rollup-plugin-visualizer` — generates treemap of bundle contents
- `gzip-size` — measure gzipped size programmatically
- `bun run build` output shows sizes

### Project Structure Notes

- Modify: `apps/widget/vite.config.ts` to add visualizer plugin
- Modify: build script to add size check gate
- Output: `dist/widget.js` (IIFE bundle), `dist/stats.html` (analyzer report)

### References

- docs/research-widget-css-isolation.md Section 14
- NFR4: Widget JavaScript must load in <200ms
- NFR10: Widget bundle size must remain <150KB (minified + gzipped)
