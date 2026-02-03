# Story 0.7: Configure ESLint with Shared Rules

Status: done

## Story

As a **developer**,
I want consistent linting rules across all packages,
So that code style is uniform throughout the codebase.

## Acceptance Criteria

1. **Given** multiple packages in the monorepo
   **When** I configure ESLint
   **Then** `packages/eslint-config` contains shared ESLint configurations

2. **And** All packages extend from appropriate shared config

3. **And** Rules include TypeScript-specific checks

4. **And** `pnpm lint` runs linting across all packages

5. **And** Zero lint errors on initial setup

## Tasks / Subtasks

- [ ] Task 1: Verify/Update shared ESLint configs (AC: 1, 3)
  - [ ] Verify `packages/eslint-config/` structure
  - [ ] Ensure base config has TypeScript rules
  - [ ] Create/verify `nest.js` config for backend
  - [ ] Create/verify `next.js` config for dashboard
  - [ ] Create `preact.js` config for widget (prep)

- [ ] Task 2: Update all packages to extend shared configs (AC: 2)
  - [ ] apps/web extends next.js config
  - [ ] apps/api extends nest.js config
  - [ ] packages/* extend base config

- [ ] Task 3: Add essential linting rules (AC: 3)
  - [ ] Add `@typescript-eslint/explicit-function-return-type` (warn)
  - [ ] Add `@typescript-eslint/no-explicit-any` (warn)
  - [ ] Add `@typescript-eslint/no-unused-vars` (error)
  - [ ] Add import sorting rules

- [ ] Task 4: Configure Turbo lint task (AC: 4)
  - [ ] Verify turbo.json has `lint` task
  - [ ] Ensure lint runs across all packages
  - [ ] Test with `pnpm lint`

- [ ] Task 5: Fix lint errors (AC: 5)
  - [ ] Run `pnpm lint` across all packages
  - [ ] Fix or add eslint-disable for acceptable warnings
  - [ ] Document any ignored rules with justification

## Dev Notes

### Current State

From Story 0.1 completion notes:
- `packages/eslint-config/` exists with ESLint 9 configuration
- `pnpm lint` pipeline executes correctly
- Warnings exist in API package related to undeclared env vars

### ESLint Config Structure

```
packages/eslint-config/
├── base.js          # Base rules for all packages
├── next.js          # Next.js specific rules
├── nest.js          # NestJS specific rules
├── preact.js        # Preact widget rules (create)
└── package.json
```

### Base Config (ESLint 9 Flat Config)

```javascript
// packages/eslint-config/base.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**'],
  }
);
```

### NestJS Config

```javascript
// packages/eslint-config/nest.js
import baseConfig from './base.js';

export default [
  ...baseConfig,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // NestJS uses decorators extensively
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
    },
  },
];
```

### Architecture Compliance

- **NFR66:** All code must pass linting rules (ESLint) before merge

### Key Rules to Enforce

| Rule | Level | Reason |
|------|-------|--------|
| `no-unused-vars` | error | Clean code |
| `no-explicit-any` | warn | Type safety |
| `no-console` | warn (prod) | No console logs |
| `prefer-const` | error | Immutability |
| `eqeqeq` | error | Strict equality |

### Testing Requirements

- `pnpm lint` must pass with zero errors
- Warnings are acceptable but should be minimized
- No eslint-disable without comment

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#4-Monorepo-Structure]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.7]
- [ESLint Flat Config: https://eslint.org/docs/latest/use/configure/configuration-files-new]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to verify/modify:
- `packages/eslint-config/base.js`
- `packages/eslint-config/nest.js`
- `packages/eslint-config/next.js`
- `packages/eslint-config/preact.js` (create)
- `apps/api/eslint.config.js`
- `apps/web/eslint.config.mjs`
