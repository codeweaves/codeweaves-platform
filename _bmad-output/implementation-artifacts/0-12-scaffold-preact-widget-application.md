# Story 0.12: Scaffold Preact Widget Application

Status: done

## Story

As a **developer**,
I want a Preact + Vite application in `apps/widget`,
So that I can build the embeddable chat widget with minimal bundle size.

## Acceptance Criteria

1. **Given** the monorepo structure exists
   **When** I create the widget application
   **Then** `apps/widget` contains a Preact + Vite application

2. **And** TypeScript strict mode is enabled

3. **And** Build output is optimized for production (<150KB)

4. **And** Shadow DOM setup is scaffolded

5. **And** `pnpm dev --filter=widget` starts the development server

## Tasks / Subtasks

- [ ] Task 1: Initialize Preact + Vite application (AC: 1)
  - [ ] Create `apps/widget/` directory
  - [ ] Initialize with Vite + Preact template
  - [ ] Configure package.json with proper workspace deps

- [ ] Task 2: Configure TypeScript (AC: 2)
  - [ ] Create `tsconfig.json` extending preact config
  - [ ] Enable strict mode
  - [ ] Configure JSX for Preact

- [ ] Task 3: Set up Vite configuration (AC: 3)
  - [ ] Configure build output as IIFE bundle
  - [ ] Enable minification and tree-shaking
  - [ ] Configure chunk splitting
  - [ ] Add bundle size analyzer

- [ ] Task 4: Scaffold Shadow DOM entry (AC: 4)
  - [ ] Create `src/shadow-dom.ts` initialization
  - [ ] Create closed Shadow DOM wrapper
  - [ ] Set up CSS injection into shadow root

- [ ] Task 5: Create minimal widget structure (AC: 1, 5)
  - [ ] Create `src/index.ts` entry point
  - [ ] Create `src/components/Widget.tsx` shell
  - [ ] Create `src/styles/widget.css` base styles
  - [ ] Verify dev server starts

- [ ] Task 6: Verify bundle size (AC: 3)
  - [ ] Run production build
  - [ ] Check bundle size < 150KB gzipped
  - [ ] Verify Preact is used (not React)

## Dev Notes

### Widget Structure

```
apps/widget/
├── src/
│   ├── components/
│   │   ├── Widget.tsx          # Main widget wrapper
│   │   ├── ChatWindow.tsx      # Chat container (stub)
│   │   └── IconButton.tsx      # Minimized icon (stub)
│   ├── hooks/
│   │   └── index.ts            # Hook exports (stub)
│   ├── services/
│   │   └── index.ts            # API services (stub)
│   ├── utils/
│   │   └── index.ts            # Utilities (stub)
│   ├── shadow-dom.ts           # Shadow DOM initialization
│   ├── index.ts                # Entry point
│   └── styles/
│       └── widget.css          # Base styles
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts          # Widget-specific Tailwind
└── package.json
```

### Package.json

```json
{
  "name": "@codeweaves/widget",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "check-types": "tsc --noEmit",
    "analyze": "vite build --mode analyze"
  },
  "dependencies": {
    "preact": "^10.19.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.8.0",
    "@repo/typescript-config": "workspace:*",
    "@repo/eslint-config": "workspace:*",
    "vite": "^5.4.0",
    "typescript": "^5.9.0",
    "tailwindcss": "^4.0.0",
    "rollup-plugin-visualizer": "^5.12.0"
  }
}
```

### Vite Configuration

```typescript
// apps/widget/vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => ({
  plugins: [
    preact(),
    mode === 'analyze' && visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
    }),
  ].filter(Boolean),
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'CodeWeavesWidget',
      fileName: 'widget',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    target: 'es2020',
    sourcemap: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
}));
```

### Shadow DOM Initialization

```typescript
// apps/widget/src/shadow-dom.ts
import { render } from 'preact';
import { Widget } from './components/Widget';
import styles from './styles/widget.css?inline';

export function initWidget(config: { agentId: string }) {
  // Create container
  const container = document.createElement('div');
  container.id = 'codeweaves-widget-root';
  document.body.appendChild(container);

  // Create closed shadow DOM
  const shadow = container.attachShadow({ mode: 'closed' });

  // Inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  shadow.appendChild(styleSheet);

  // Create mount point
  const mount = document.createElement('div');
  mount.id = 'widget-mount';
  shadow.appendChild(mount);

  // Render Preact app
  render(<Widget agentId={config.agentId} />, mount);

  return {
    destroy: () => {
      render(null, mount);
      container.remove();
    },
  };
}
```

### Entry Point

```typescript
// apps/widget/src/index.ts
import { initWidget } from './shadow-dom';

// Auto-init from script tag
(function () {
  const script = document.currentScript as HTMLScriptElement;
  if (!script) return;

  const agentId = script.dataset.agentId;
  if (!agentId) {
    console.warn('[CodeWeaves] Missing data-agent-id attribute');
    return;
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWidget({ agentId }));
  } else {
    initWidget({ agentId });
  }
})();

// Also export for manual initialization
export { initWidget };
```

### Architecture Compliance

- **ADR-004:** Preact + Shadow DOM for Widget
  - 3KB React-like runtime
  - Complete CSS isolation from host pages
  - CSS Variables for theme customization
- **NFR10:** Widget bundle size must remain <150KB (minified)
- **NFR4:** Widget JavaScript must load in <200ms

### Bundle Size Budget

| Component | Budget |
|-----------|--------|
| Preact runtime | ~4KB |
| Widget code | ~50KB |
| Styles | ~10KB |
| **Total (gzipped)** | **<150KB** |

### Testing Requirements

- Dev server must start without errors
- Production build must complete
- Bundle size must be under 150KB gzipped
- Shadow DOM must isolate styles

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#7-Widget-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.12]
- [Preact Documentation: https://preactjs.com/guide/v10/getting-started]
- [Vite Library Mode: https://vitejs.dev/guide/build.html#library-mode]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/widget/package.json`
- `apps/widget/tsconfig.json`
- `apps/widget/vite.config.ts`
- `apps/widget/tailwind.config.ts`
- `apps/widget/src/index.ts`
- `apps/widget/src/shadow-dom.ts`
- `apps/widget/src/components/Widget.tsx`
- `apps/widget/src/styles/widget.css`
