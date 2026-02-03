# Story 0.1: Initialize Turborepo Monorepo Structure

Status: done

## Story

As a **developer**,
I want a properly configured Turborepo monorepo,
So that I can work on multiple packages with shared tooling and cached builds.

## Acceptance Criteria

1. **Given** a fresh codebase
   **When** I set up the monorepo structure
   **Then** Turborepo is configured with pnpm workspaces

2. **And** `apps/` directory contains `web` (Next.js dashboard)

3. **And** `packages/` directory contains shared configurations

4. **And** `turbo.json` defines build pipelines with caching

5. **And** `pnpm-workspace.yaml` lists all workspace packages

6. **And** Running `pnpm install` installs all dependencies

## Tasks / Subtasks

- [x] Task 1: Verify Turborepo + pnpm workspace configuration (AC: 1, 4, 5)
  - [x] Confirm `turbo.json` exists with proper task definitions
  - [x] Confirm `pnpm-workspace.yaml` includes `apps/*` and `packages/*`
  - [x] Confirm root `package.json` has turbo scripts

- [x] Task 2: Verify apps directory structure (AC: 2)
  - [x] Confirm `apps/web` exists with Next.js dashboard
  - [x] Note: `apps/docs` exists (will be removed in Story 0.2)
  - [x] Note: `apps/api` exists (NestJS scaffolded)

- [x] Task 3: Verify packages directory structure (AC: 3)
  - [x] Confirm `packages/typescript-config` exists
  - [x] Confirm `packages/eslint-config` exists
  - [x] Confirm `packages/jest-config` exists
  - [x] Confirm `packages/ui` exists (Shadcn components)

- [x] Task 4: Verify dependency installation works (AC: 6)
  - [x] Run `pnpm install` and confirm no errors
  - [x] Verify all workspace packages resolve correctly

- [x] Task 5: Verify Turbo build pipeline works
  - [x] Run `pnpm build` and verify cached builds work
  - [x] Verify task dependencies are correct

## Dev Notes

### Current Project State Analysis

The Turborepo monorepo structure is **already initialized** and functional. This story requires verification rather than creation.

**What Exists:**
```
codeweaves-platform/
├── apps/
│   ├── api/          # NestJS backend (scaffolded)
│   ├── docs/         # Default Turborepo app (to be removed in 0.2)
│   └── web/          # Next.js dashboard
├── packages/
│   ├── eslint-config/
│   ├── jest-config/
│   ├── typescript-config/
│   └── ui/
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── pnpm-lock.yaml
```

**What's Missing (for later stories):**
- `apps/widget` - Story 0.12
- `packages/validation` - Story 0.4
- `packages/theme` - Part of Epic 4
- `packages/widget-ui` - Part of Epic 5

### Architecture Compliance

**ADR-001: Monorepo with Turborepo** - ✅ Compliant
- Single repository for all applications and packages
- pnpm workspaces configured
- Turborepo handles cached builds

**Required turbo.json tasks:**
- `build` - with `^build` dependency chain
- `dev` - persistent, no cache
- `lint` - with dependency chain
- `test` - with coverage outputs
- `check-types` - TypeScript validation

### Technical Requirements

**Turborepo Version:** ^2.8.0 (confirmed in root package.json)
**pnpm Version:** 9.0.0 (confirmed in packageManager field)
**Node Version:** >=18 (confirmed in engines field)
**TypeScript Version:** 5.9.2

### File Structure Requirements

Per architecture document section 4, the following structure must be maintained:

```
codeweaves-platform/
├── apps/
│   ├── web/          # Next.js v16 Dashboard
│   ├── api/          # NestJS Backend
│   └── widget/       # Preact Widget (Story 0.12)
├── packages/
│   ├── validation/   # Shared Zod Schemas (Story 0.4)
│   ├── theme/        # Theme Utilities
│   ├── widget-ui/    # Shared Widget Components
│   ├── ui/           # Shadcn UI Components
│   ├── typescript-config/
│   └── eslint-config/
├── .github/workflows/
├── docker/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Testing Requirements

For this story, verify:
1. `pnpm install` completes without errors
2. `pnpm build` runs successfully for all existing packages
3. `pnpm lint` executes across all packages
4. `pnpm check-types` passes TypeScript validation

### Project Structure Notes

- Alignment: Current structure matches Turborepo best practices
- Legacy: `AgentEditor/` folder exists at root - appears to be legacy code, should be reviewed for migration or removal
- Note: `apps/docs` is default Turborepo example - scheduled for removal in Story 0.2

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#4-Monorepo-Structure]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.1]
- [Turborepo Documentation: https://turbo.build/repo/docs]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

- **Task 4 (pnpm install):** Successfully installed all 8 workspace projects with 607 packages, native modules compiled correctly
- **Task 5 (build verification):**
  - Initial build revealed TypeScript configuration issues in @repo/api (moduleResolution conflict, testcontainers imports)
  - Fixed: apps/api/tsconfig.json - added `moduleResolution: node` to override base config
  - Fixed: Added @testcontainers/postgresql dependency and updated imports in test setup files
  - Fixed: test/utils/test-app.ts - updated type to support DynamicModule
  - All 3 packages (api, web, docs) now build successfully
  - Verified Turbo caching works: second build completed in 603ms with FULL TURBO (all cache hits)
- **check-types:** Passes successfully across 4 packages
- **lint:** Pipeline executes correctly; warnings exist in API package related to undeclared env vars (to be addressed in Story 0.7)

### File List

Files verified (existing):
- `turbo.json` - Correct task definitions with ^build dependency chain
- `pnpm-workspace.yaml` - Includes apps/* and packages/*
- `package.json` - Has turbo scripts, correct versions
- `apps/web/package.json` - Next.js 16 with proper links
- `apps/docs/package.json` - Next.js 16 with proper links
- `apps/api/package.json` - NestJS 11 with proper links
- `packages/typescript-config/` - base.json, nextjs.json, react-library.json
- `packages/eslint-config/` - ESLint 9 configuration
- `packages/jest-config/` - Jest 29 configuration
- `packages/ui/` - Shared UI components

Files modified:
- `apps/api/tsconfig.json` - Added moduleResolution: node
- `apps/api/package.json` - Added @testcontainers/postgresql dependency
- `apps/api/test/setup/global-setup.ts` - Fixed import path
- `apps/api/test/setup/global-teardown.ts` - Fixed import path
- `apps/api/test/utils/test-app.ts` - Fixed type definition

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-03 | Verified monorepo structure, fixed API build issues, all ACs met | Claude Opus 4.5 |
| 2026-02-03 | Code review completed - All 6 ACs verified and passing, story approved | Claude Sonnet 4.5 |
