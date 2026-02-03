# Story 0.6: Set Up TypeScript Strict Configuration

Status: done

## Story

As a **developer**,
I want TypeScript strict mode enabled across all packages,
So that code quality is enforced at compile time.

## Acceptance Criteria

1. **Given** multiple packages in the monorepo
   **When** I configure TypeScript
   **Then** `packages/typescript-config` contains shared tsconfig files

2. **And** All packages extend from shared configuration

3. **And** `strict: true` is enabled in base config

4. **And** `pnpm typecheck` runs type checking across all packages (Note: currently `pnpm check-types`)

5. **And** Zero type errors on initial setup

## Tasks / Subtasks

- [ ] Task 1: Verify/Update base TypeScript config (AC: 1, 3)
  - [ ] Check `packages/typescript-config/base.json` has `strict: true`
  - [ ] Verify all strict flags are enabled
  - [ ] Add `noUncheckedIndexedAccess` if not present

- [ ] Task 2: Create/verify framework-specific configs (AC: 1)
  - [ ] Verify `nextjs.json` for apps/web
  - [ ] Verify/create `nestjs.json` for apps/api
  - [ ] Create `preact.json` for apps/widget (prep for Story 0.12)
  - [ ] Verify `react-library.json` for packages/ui

- [ ] Task 3: Update all packages to extend shared configs (AC: 2)
  - [ ] apps/web/tsconfig.json extends nextjs.json
  - [ ] apps/api/tsconfig.json extends nestjs.json
  - [ ] packages/*/tsconfig.json extend base.json

- [ ] Task 4: Add typecheck script to root (AC: 4)
  - [ ] Ensure turbo.json has `check-types` task
  - [ ] Add `typecheck` alias if not present
  - [ ] Verify task runs across all packages

- [ ] Task 5: Fix any type errors (AC: 5)
  - [ ] Run `pnpm check-types` across all packages
  - [ ] Fix any type errors found
  - [ ] Verify zero errors

## Dev Notes

### Base TypeScript Config

```json
// packages/typescript-config/base.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

### NestJS Config

```json
// packages/typescript-config/nestjs.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2021",
    "lib": ["ES2021"],
    "outDir": "./dist",
    "rootDir": "./src",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "incremental": true,
    "sourceMap": true
  }
}
```

### Preact Config (for Story 0.12)

```json
// packages/typescript-config/preact.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```

### Current State

From Story 0.1 completion notes:
- `packages/typescript-config/` exists with base.json, nextjs.json, react-library.json
- `pnpm check-types` passes across 4 packages

### Architecture Compliance

- **NFR65:** All code must pass TypeScript type checking with strict mode enabled

### Strict Mode Flags

| Flag | Purpose |
|------|---------|
| `strict` | Enables all strict type checks |
| `strictNullChecks` | null/undefined must be handled |
| `strictPropertyInitialization` | Class properties must be initialized |
| `noImplicitAny` | No implicit any types |
| `noUncheckedIndexedAccess` | Array/object access includes undefined |

### Testing Requirements

- `pnpm check-types` must pass with zero errors
- All packages must compile successfully
- No `@ts-ignore` or `@ts-nocheck` comments

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#4-Monorepo-Structure]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.6]
- [TypeScript Strict Mode: https://www.typescriptlang.org/tsconfig#strict]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to verify/modify:
- `packages/typescript-config/base.json`
- `packages/typescript-config/nestjs.json`
- `packages/typescript-config/preact.json` (create)
- `apps/api/tsconfig.json`
- `apps/web/tsconfig.json`
