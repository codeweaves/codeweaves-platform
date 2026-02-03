# Story 0.2: Remove Default Docs App

Status: done

## Story

As a **developer**,
I want the default `apps/docs` removed from the Turborepo template,
So that the codebase only contains our actual applications.

## Acceptance Criteria

1. **Given** the default Turborepo setup
   **When** I clean up unnecessary packages
   **Then** `apps/docs` directory is deleted

2. **And** References to docs are removed from `turbo.json`

3. **And** No build errors occur after removal

## Tasks / Subtasks

- [ ] Task 1: Remove apps/docs directory (AC: 1)
  - [ ] Delete `apps/docs/` folder completely
  - [ ] Verify no files remain

- [ ] Task 2: Clean up Turborepo references (AC: 2)
  - [ ] Check `turbo.json` for any docs-specific configurations
  - [ ] Remove any docs-specific task configurations if present
  - [ ] Update any workspace filters that reference docs

- [ ] Task 3: Verify build pipeline still works (AC: 3)
  - [ ] Run `pnpm install` to update workspace
  - [ ] Run `pnpm build` and verify no errors
  - [ ] Run `pnpm lint` and verify no errors
  - [ ] Run `pnpm check-types` and verify no errors

- [ ] Task 4: Clean up any orphaned dependencies
  - [ ] Check root package.json for docs-only dependencies
  - [ ] Remove any unused dependencies

## Dev Notes

### Current State

The `apps/docs` directory is the default Turborepo example application. It's a Next.js app that serves as documentation template but is not part of the CodeWeaves platform.

### What to Delete

```
apps/docs/
├── app/
├── public/
├── next.config.ts
├── package.json
├── tsconfig.json
└── ... (all contents)
```

### Verification Commands

```bash
# After deletion, run:
pnpm install          # Update workspace
pnpm build           # Verify build works
pnpm lint            # Verify linting works
pnpm check-types     # Verify types work
```

### Architecture Compliance

Per ADR-001 (Monorepo with Turborepo), only these apps should exist:
- `apps/web` - Next.js Dashboard
- `apps/api` - NestJS Backend
- `apps/widget` - Preact Widget (Story 0.12)

### Testing Requirements

- Verify `pnpm build` completes with only `web` and `api` apps
- Verify no broken imports or references to docs

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#4-Monorepo-Structure]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to delete:
- `apps/docs/` (entire directory)

Files to verify:
- `turbo.json`
- `pnpm-workspace.yaml`
- Root `package.json`
