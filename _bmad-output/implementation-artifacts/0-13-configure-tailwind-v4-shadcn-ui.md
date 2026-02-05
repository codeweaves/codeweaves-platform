# Story 0.13: Configure Tailwind CSS v4 + Shadcn UI

Status: done

## Story

As a **frontend developer**,
I want Tailwind CSS v4 and Shadcn UI configured,
So that I can build consistent, accessible UI components with proper styling.

## Acceptance Criteria

1. **Given** Next.js dashboard exists
   **When** installing Tailwind CSS v4
   **Then** Tailwind is configured with @tailwindcss/postcss plugin

2. **And** Tailwind utilities work in components

3. **And** Shadcn UI is initialized with proper configuration

4. **And** `cn()` utility function is available for className merging

5. **And** Shadcn components are available (Button, DropdownMenu, Avatar)

6. **And** Theme colors use OKLCH format with CSS variables

7. **And** CSS-first configuration (no tailwind.config.ts)

## Tasks / Subtasks

- [ ] Task 1: Install Tailwind CSS v4 (AC: 1, 7)
  - [ ] Install `tailwindcss` and `@tailwindcss/postcss`
  - [ ] Create `postcss.config.mjs`
  - [ ] Update `globals.css` with Tailwind v4 directives
  - [ ] Note: No tailwind.config.ts needed (CSS-first config)

- [ ] Task 2: Configure CSS variables with OKLCH colors (AC: 6)
  - [ ] Define :root CSS variables in OKLCH format
  - [ ] Define .dark CSS variables in OKLCH format
  - [ ] Add @theme inline block to map variables

- [ ] Task 3: Set up Shadcn UI (AC: 3, 4)
  - [ ] Install dependencies: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
  - [ ] Install `tw-animate-css` for animations
  - [ ] Create `lib/utils.ts` with `cn()` function
  - [ ] Create `components.json` configuration

- [ ] Task 4: Install Shadcn components (AC: 5)
  - [ ] Run `pnpm dlx shadcn@latest add button`
  - [ ] Run `pnpm dlx shadcn@latest add dropdown-menu`
  - [ ] Run `pnpm dlx shadcn@latest add avatar`
  - [ ] Components auto-generated in `components/ui/`

- [ ] Task 5: Test styling (AC: 2)
  - [ ] Verify Tailwind utilities work
  - [ ] Test dark mode toggle
  - [ ] Test responsive design
  - [ ] Verify component variants work

## Dev Notes

### Tailwind CSS v4 Installation (2026)

```bash
cd apps/web
pnpm add tailwindcss @tailwindcss/postcss
pnpm add -D tw-animate-css
```

### PostCSS Configuration

```javascript
// apps/web/postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

### CSS-First Configuration

**Important:** Tailwind v4 uses CSS-first configuration. There is **NO tailwind.config.ts** file. All configuration happens in `globals.css`.

### Updated globals.css (OKLCH Colors + @theme inline)

```css
/* apps/web/app/globals.css */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* Light mode CSS variables (OKLCH format) */
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.5rem;
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
}

/* Dark mode CSS variables (OKLCH format) */
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.145 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.145 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.396 0.141 25.723);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.269 0 0);
  --input: oklch(0.269 0 0);
  --ring: oklch(0.439 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
}

/* Map CSS variables to Tailwind theme */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

/* Base styles */
* {
  border-color: var(--border);
}

body {
  background-color: var(--background);
  color: var(--foreground);
}
```

### Shadcn UI Setup

```bash
# Install dependencies
pnpm add class-variance-authority clsx tailwind-merge lucide-react
pnpm add -D tw-animate-css
```

### Utils File

```typescript
// apps/web/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### components.json (Tailwind v4)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

### Installing Shadcn Components

```bash
# Use Shadcn CLI to add components
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add dropdown-menu
pnpm dlx shadcn@latest add avatar

# Additional components as needed
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add input
```

### Architecture Compliance

- **ADR-003:** Next.js v16 for Dashboard - Tailwind CSS v4, Shadcn UI
- **ADR-009:** CSS Variables for Theme Customization
- **NFR47:** Dashboard must follow Shadcn design system

### Key Changes in Tailwind v4 (2026)

| Feature | Tailwind v3 | Tailwind v4 |
|---------|-------------|-------------|
| Config file | `tailwind.config.ts` | CSS-first (no config file) |
| Color format | HSL | OKLCH |
| Animation | `tailwindcss-animate` | `tw-animate-css` |
| Dark mode | `darkMode: ['class']` | `@custom-variant dark` |
| Theme mapping | `theme.extend.colors` | `@theme inline` |

### Component Replacement

**Before (manual):**
```typescript
<button className="bg-blue-600 text-white hover:bg-blue-700">
  Login
</button>
```

**After (Shadcn):**
```typescript
<Button variant="default">
  Login
</Button>
```

### Testing Requirements

```typescript
describe('Tailwind + Shadcn Setup', () => {
  it('should render Button with proper styles', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByText('Click me');
    expect(button).toHaveClass('inline-flex');
  });

  it('should support button variants', () => {
    render(<Button variant="outline">Click me</Button>);
    const button = screen.getByText('Click me');
    expect(button).toHaveClass('border');
  });

  it('should merge classNames with cn()', () => {
    const result = cn('px-4', 'py-2', 'px-6');
    expect(result).toBe('py-2 px-6'); // tailwind-merge deduplicates
  });
});
```

### References

- [Shadcn UI Tailwind v4 Docs](https://ui.shadcn.com/docs/tailwind-v4)
- [Shadcn UI Next.js Installation](https://ui.shadcn.com/docs/installation/next)
- [Source: _bmad-output/planning-artifacts/architecture.md#ADR-003]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/web/postcss.config.mjs`
- `apps/web/lib/utils.ts`
- `apps/web/components.json`
- `apps/web/components/ui/button.tsx` (via shadcn CLI)
- `apps/web/components/ui/dropdown-menu.tsx` (via shadcn CLI)
- `apps/web/components/ui/avatar.tsx` (via shadcn CLI)

Files to modify:
- `apps/web/app/globals.css` (Tailwind v4 + OKLCH colors + @theme inline)
- `apps/web/package.json` (add dependencies)

Files NOT needed (Tailwind v4 CSS-first):
- ~~`apps/web/tailwind.config.ts`~~ (removed - config in CSS now)
