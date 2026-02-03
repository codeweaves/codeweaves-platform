# Story 0.4: Create Shared Contracts & Validation Package

Status: done

## Story

As a **developer**,
I want a shared Zod schemas package in `packages/validation`,
So that frontend and backend share the same validation logic and API contracts.

## Acceptance Criteria

1. **Given** the monorepo structure exists
   **When** I create the validation package
   **Then** `packages/validation` contains Zod schema definitions

2. **And** Schemas can be imported by both `apps/web` and `apps/api`

3. **And** TypeScript types are inferred from Zod schemas

4. **And** Package includes request/response types for all API endpoints

5. **And** Package exports are properly configured in `package.json`

## Tasks / Subtasks

- [ ] Task 1: Create validation package structure (AC: 1)
  - [ ] Create `packages/validation/` directory
  - [ ] Initialize `package.json` with proper configuration
  - [ ] Create `tsconfig.json` extending shared config
  - [ ] Install `zod` as dependency

- [ ] Task 2: Create core schema files (AC: 1, 4)
  - [ ] Create `src/schemas/user.schema.ts`
  - [ ] Create `src/schemas/organization.schema.ts`
  - [ ] Create `src/schemas/agent.schema.ts`
  - [ ] Create `src/schemas/theme.schema.ts`
  - [ ] Create `src/schemas/chat.schema.ts`
  - [ ] Create `src/schemas/analytics.schema.ts`
  - [ ] Create `src/schemas/index.ts` barrel export

- [ ] Task 3: Set up TypeScript type exports (AC: 3)
  - [ ] Create `src/types/index.ts` with inferred types
  - [ ] Export `z.infer<typeof schema>` for each schema
  - [ ] Ensure types are properly exported

- [ ] Task 4: Configure package exports (AC: 5)
  - [ ] Set up `exports` field in package.json
  - [ ] Configure `main`, `types`, `module` fields
  - [ ] Ensure tree-shaking is supported

- [ ] Task 5: Verify cross-package imports (AC: 2)
  - [ ] Add `@codeweaves/validation` to apps/api dependencies
  - [ ] Add `@codeweaves/validation` to apps/web dependencies
  - [ ] Verify imports work in both packages
  - [ ] Run build to verify no issues

## Dev Notes

### Package Structure

```
packages/validation/
├── src/
│   ├── schemas/
│   │   ├── user.schema.ts
│   │   ├── organization.schema.ts
│   │   ├── agent.schema.ts
│   │   ├── theme.schema.ts
│   │   ├── chat.schema.ts
│   │   ├── analytics.schema.ts
│   │   └── index.ts
│   ├── types/
│   │   └── index.ts
│   └── index.ts
├── tsconfig.json
└── package.json
```

### Example Schema Pattern

```typescript
// packages/validation/src/schemas/agent.schema.ts
import { z } from 'zod';

export const agentStatusSchema = z.enum(['active', 'inactive']);

export const createAgentSchema = z.object({
  name: z.string().min(2).max(100),
  status: agentStatusSchema.default('active'),
  allowedDomains: z.array(z.string()).default([]),
});

export const updateAgentSchema = createAgentSchema.partial();

export const agentSchema = z.object({
  id: z.string().uuid(),
  publicId: z.string().length(8),
  name: z.string(),
  status: agentStatusSchema,
  allowedDomains: z.array(z.string()),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Type exports
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type Agent = z.infer<typeof agentSchema>;
```

### Package.json Configuration

```json
{
  "name": "@codeweaves/validation",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./schemas": {
      "import": "./dist/schemas/index.mjs",
      "require": "./dist/schemas/index.js",
      "types": "./dist/schemas/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "lint": "eslint src/",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@repo/eslint-config": "workspace:*",
    "tsup": "^8.0.0",
    "typescript": "^5.9.0"
  }
}
```

### Architecture Compliance

- **NFR89:** Shared validation schemas must use Zod across frontend and backend
- **NFR74:** Shared TypeScript types must be generated from Zod schemas

### Schemas Required (Initial Set)

Based on architecture and PRD:

| Schema | Purpose |
|--------|---------|
| user | User profile, roles, invitation |
| organization | Multi-tenant org data |
| agent | Chat agent configuration |
| theme | 50+ theme options |
| chat | Messages, sessions |
| analytics | KPIs, events |

### Testing Requirements

- TypeScript compilation must pass
- Schemas must be importable in both apps
- Type inference must work correctly

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#8-Shared-Packages]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.4]
- [Zod Documentation: https://zod.dev]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `packages/validation/package.json`
- `packages/validation/tsconfig.json`
- `packages/validation/src/index.ts`
- `packages/validation/src/schemas/*.ts`
- `packages/validation/src/types/index.ts`
