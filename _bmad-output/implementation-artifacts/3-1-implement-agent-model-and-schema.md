# Story 3.1: Implement Agent Model and Schema

Status: done

## Story

As a **backend developer**,
I want an Agent database model with auto-generated URL-safe public IDs,
so that chat agent configurations can be stored and referenced in embed codes without exposing internal IDs.

> **Note:** Story 3.3 (Generate URL-Safe Public IDs) has been merged into this story.

## Acceptance Criteria

1. **AC1:** Agent table stores: `id` (UUID), `publicId` (unique 8-char URL-safe string), `name`, `status`, `organizationId`
2. **AC2:** `publicId` is 8 characters long, uses URL-safe characters (nanoid), is unique across all agents, and is immutable after creation
3. **AC3:** `AgentStatus` enum includes: `ACTIVE`, `INACTIVE` — default is `ACTIVE`
4. **AC4:** Foreign key to Organization is defined with proper relation
5. **AC5:** Prisma migration creates the table successfully and passes `prisma migrate dev`
6. **AC6:** Collision on `publicId` is retried automatically (max 3 attempts)
7. **AC7:** Agent model includes soft-delete support (`deletedAt`)
8. **AC8:** Zod validation schemas are defined in the shared `@repo/validation` package
9. **AC9:** Agent NestJS module, service, and controller are scaffolded with CRUD operations
10. **AC10:** Only `ADMIN` and `SUPER_ADMIN` can create agents; creation requires `name` + `organizationId`
11. **AC11:** `organizationId` cannot be changed after creation
12. **AC12:** `SUPER_ADMIN` and `ADMIN` can list all agents across all orgs; `CLIENT` users can only list/view agents in their own organization
13. **AC13:** `GET /agents` supports pagination (`page`, `limit`), search by agent name, filter by `status` (ACTIVE/INACTIVE), optional filter by `organizationId` (for ADMIN/SUPER_ADMIN to narrow results), and sorting by `name`, `createdAt`, or `updatedAt`
14. **AC14:** Unit tests for service and controller are written and passing

## Tasks / Subtasks

- [x] **Task 1: Prisma Schema** (AC: 1, 3, 4, 5, 7)
  - [x] 1.1 Add `AgentStatus` enum to `schema.prisma`
  - [x] 1.2 Add `Agent` model with all fields, indexes, and `@@map("agents")`
  - [x] 1.3 Add `agents Agent[]` relation on `Organization` model
  - [x] 1.4 Run `bunx prisma migrate dev --name add-agent-model`
  - [x] 1.5 Verify generated migration SQL is correct

- [x] **Task 2: Public ID Utility** (AC: 2, 6)
  - [x] 2.1 Install `nanoid` package: `cd apps/api && bun add nanoid`
  - [x] 2.2 Create `apps/api/src/utils/public-id.ts` with `generatePublicId()` function
  - [x] 2.3 Use `customAlphabet` from nanoid with URL-safe chars, length 8
  - [x] 2.4 Include retry logic (max 3 attempts) for uniqueness collisions

- [x] **Task 3: Zod Validation Schemas** (AC: 8)
  - [x] 3.1 Add agent schemas to `packages/validation/src/index.ts`
  - [x] 3.2 Define `createAgentSchema` (name required, organizationId required)
  - [x] 3.3 Define `updateAgentSchema` (name optional, organizationId excluded)
  - [x] 3.4 Define `agentListQuerySchema` extending `paginationSchema`
  - [x] 3.5 Export all types and schemas

- [x] **Task 4: DTO Re-exports** (AC: 8)
  - [x] 4.1 Create `apps/api/src/models/agent.dto.ts` re-exporting from `@repo/validation`

- [x] **Task 5: Agent Logger Service** (AC: 9)
  - [x] 5.1 Create `apps/api/src/common/logger/agent.logger.ts` following `OrganizationLoggerService` pattern
  - [x] 5.2 Add audit events: `AGENT_CREATED`, `AGENT_UPDATED`, `AGENT_CREATION_EXCEPTION`, `AGENT_UPDATE_EXCEPTION`
  - [x] 5.3 Register in `LoggerModule`

- [x] **Task 6: Agents Service** (AC: 1, 2, 6, 10, 11, 12, 13)
  - [x] 6.1 Create `apps/api/src/services/agents.service.ts`
  - [x] 6.2 Inject `PrismaService` and `AgentLoggerService`
  - [x] 6.3 Implement `create(dto, user)` — generate publicId with retry, enforce org assignment
  - [x] 6.4 Implement `findAll(query, user)` — pagination, search by name, filter by status, filter by organizationId (ADMIN/SUPER_ADMIN), auto-scoped to own org for CLIENT
  - [x] 6.5 Implement `findById(id, user)` — with org-scope check for CLIENT
  - [x] 6.6 Implement `update(id, dto, user)` — exclude `organizationId` from updates
  - [x] 6.7 Implement `softDelete(id, user)` — set `deletedAt`, org-scope check
  - [x] 6.8 All queries must filter `deletedAt IS NULL` by default

- [x] **Task 7: Agents Controller** (AC: 9, 10, 12, 13)
  - [x] 7.1 Create `apps/api/src/controllers/agents/agents.controller.ts`
  - [x] 7.2 `POST /agents` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN)` only
  - [x] 7.3 `GET /agents` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)`, with `@ApiQuery` for page, limit, search, status, organizationId, sortBy, sortOrder
  - [x] 7.4 `GET /agents/:id` — same roles, service handles scoping
  - [x] 7.5 `PATCH /agents/:id` — same roles, service handles scoping
  - [x] 7.6 `DELETE /agents/:id` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN)` only
  - [x] 7.7 Full Swagger documentation on all endpoints
  - [x] 7.8 Use `@CurrentUser()` decorator to pass user context to service

- [x] **Task 8: Agents Module** (AC: 9)
  - [x] 8.1 Create `apps/api/src/modules/agents.module.ts`
  - [x] 8.2 Import `PrismaModule`, `LoggerModule`
  - [x] 8.3 Register in `AppModule` imports

- [x] **Task 9: Unit Tests** (AC: 14)
  - [x] 9.1 Create `apps/api/test/services/agents/agents.service.spec.ts`
  - [x] 9.2 Create `apps/api/test/controllers/agents/agents.controller.spec.ts`
  - [x] 9.3 Test: create agent generates publicId and stores correctly
  - [x] 9.4 Test: publicId collision triggers retry
  - [x] 9.5 Test: CLIENT user cannot create agents (role guard)
  - [x] 9.6 Test: CLIENT user only sees own org's agents, ADMIN/SUPER_ADMIN see all
  - [x] 9.7 Test: organizationId cannot be updated
  - [x] 9.8 Test: soft-delete sets deletedAt, subsequent queries exclude it
  - [x] 9.9 Test: validation rejects invalid input
  - [x] 9.10 Test: findAll pagination, search, status filter, org filter work correctly
  - [x] 9.11 Run `bun run test` and confirm all pass

## Dev Notes

### Prisma Schema — Exact Model

Follow the architecture spec. Add to `schema.prisma`:

```prisma
enum AgentStatus {
  ACTIVE
  INACTIVE
}

model Agent {
  id             String       @id @default(uuid())
  publicId       String       @unique @db.VarChar(8)
  name           String
  status         AgentStatus  @default(ACTIVE)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  allowedDomains String[]
  systemPrompt   String?      @db.Text
  welcomeMessage String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?

  @@index([publicId])
  @@index([organizationId])
  @@index([status])
  @@map("agents")
}
```

Also add to `Organization` model:

```prisma
agents Agent[]
```

> **Do NOT add** `AgentTheme`, `AgentSecret`, `ChatSession`, or `UsageEvent` relations yet — those come in later stories/epics. Only add what this story needs.

### Public ID Generation

Create `apps/api/src/utils/public-id.ts`:

```typescript
import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generate = customAlphabet(alphabet, 8);

export function generatePublicId(): string {
  return generate();
}
```

Collision retry is handled in the service (same pattern as `OrganizationsService.create` slug retry).

### Validation Schemas

Add to `packages/validation/src/index.ts`:

```typescript
// Agent schemas
export const createAgentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name must be at most 100 characters'),
  organizationId: z.string().uuid('Invalid organization ID'),
});

export type CreateAgentDto = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;

export const agentListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type AgentListQuery = z.infer<typeof agentListQuerySchema>;
```

### Permission Model

| Action | SUPER_ADMIN | ADMIN | CLIENT |
|--------|:-----------:|:-----:|:------:|
| Create agent | Yes | Yes | No |
| List agents (all orgs) | Yes | Yes | No |
| List agents (filter by org) | Yes | Yes | No |
| List agents (own org only) | N/A | N/A | Yes (auto-scoped) |
| View agent | Yes | Yes | Yes (own org) |
| Update agent name | Yes | Yes | Yes (own org) |
| Change org | No | No | No |
| Delete agent | Yes | Yes | No |

### Service — Org Scoping Pattern

For CLIENT users, always auto-scope to their org. For ADMIN/SUPER_ADMIN, optionally filter by `organizationId` query param:

```typescript
// In findAll:
const where: Prisma.AgentWhereInput = {
  deletedAt: null,
  // CLIENT: always scoped to own org
  ...(user.role === Role.CLIENT && { organizationId: user.organizationId }),
  // ADMIN/SUPER_ADMIN: optional org filter from query param
  ...(user.role !== Role.CLIENT && query.organizationId && { organizationId: query.organizationId }),
  // Search by name
  ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
  // Filter by status
  ...(query.status && { status: query.status }),
};
```

### Controller — @CurrentUser() Usage

Pass the current user to service methods so the service can enforce org scoping:

```typescript
@Post()
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
async create(
  @Body(new ZodValidationPipe(createAgentSchema)) dto: CreateAgentDto,
  @CurrentUser() user: CurrentUserData,
) {
  return this.agentsService.create(dto, user);
}
```

### File Structure for This Story

```
apps/api/
├── prisma/
│   └── schema.prisma                          # Modified — add Agent model + AgentStatus enum
├── src/
│   ├── controllers/
│   │   └── agents/
│   │       └── agents.controller.ts           # NEW
│   ├── services/
│   │   └── agents.service.ts                  # NEW
│   ├── modules/
│   │   ├── agents.module.ts                   # NEW
│   │   └── app.module.ts                      # Modified — import AgentsModule
│   ├── models/
│   │   └── agent.dto.ts                       # NEW — re-export from @repo/validation
│   ├── common/
│   │   └── logger/
│   │       ├── agent.logger.ts                # NEW
│   │       └── logger.module.ts               # Modified — register AgentLoggerService
│   └── utils/
│       └── public-id.ts                       # NEW
packages/
└── validation/
    └── src/
        └── index.ts                           # Modified — add agent schemas
test/
├── controllers/
│   └── agents/
│       └── agents.controller.spec.ts          # NEW
└── services/
    └── agents/
        └── agents.service.spec.ts             # NEW
```

### Project Structure Notes

- Follow exact same patterns as `OrganizationsModule` — same folder structure, same DI approach
- DTOs MUST go in `@repo/validation` shared package, NOT directly in api
- Logger service follows `OrganizationLoggerService` pattern with TracerService
- Tests follow existing `test/controllers/` and `test/services/` structure
- The `nanoid` package is NOT currently installed — must be added to `apps/api/package.json`

### References

- [Source: `apps/api/prisma/schema.prisma`] — existing model patterns
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — Agent model spec
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1277-1330] — Story 3.1 & 3.3 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/prd.md`] — FR17-FR21, FR25-FR26
- [Source: `apps/api/src/services/organizations.service.ts`] — reference pattern for service
- [Source: `apps/api/src/controllers/organizations/organizations.controller.ts`] — reference pattern for controller
- [Source: `apps/api/src/modules/organizations.module.ts`] — reference pattern for module
- [Source: `apps/api/src/common/logger/organization.logger.ts`] — reference pattern for logger
- [Source: `packages/validation/src/index.ts`] — shared validation schemas
- [Source: `AgentEditor/`] — UI reference (not implemented in this story, but informs data model)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- nanoid v5 is ESM-only — required Jest `moduleNameMapper` mock at `test/__mocks__/nanoid.ts` to avoid transform errors

### Completion Notes List

- AC1-AC7: Prisma schema with `AgentStatus` enum, `Agent` model, all fields, indexes, FK to Organization, soft-delete via `deletedAt`, migration applied successfully
- AC2, AC6: `generatePublicId()` using nanoid `customAlphabet` (62 chars, length 8), retry logic (max 3 attempts) in service `create()` method
- AC8: Zod schemas (`createAgentSchema`, `updateAgentSchema`, `agentListQuerySchema`) in `@repo/validation`, re-exported via `agent.dto.ts`
- AC9: Full NestJS module (`AgentsModule`), service (`AgentsService`), controller (`AgentsController`) with CRUD operations
- AC10: `POST /agents` restricted to `ADMIN`/`SUPER_ADMIN` via `@Roles` decorator
- AC11: `organizationId` excluded from `updateAgentSchema` and update data spread
- AC12: CLIENT auto-scoped to own org in `findAll`/`findById`; ADMIN/SUPER_ADMIN see all orgs
- AC13: Pagination, search by name, status filter, organizationId filter, sortBy (name/createdAt/updatedAt), sortOrder
- AC14: 50 unit tests (23 service + 27 controller) — all passing, 455 total regression suite green
- Audit logging via `AgentLoggerService` (AGENT_CREATED, AGENT_UPDATED, AGENT_CREATION_EXCEPTION, AGENT_UPDATE_EXCEPTION)

### Change Log

- 2026-02-18: Story 3-1 implemented — all 9 tasks complete, 50 new tests, full regression passing

### File List

**New files:**
- `apps/api/src/utils/public-id.ts`
- `apps/api/src/models/agent.dto.ts`
- `apps/api/src/common/logger/agent.logger.ts`
- `apps/api/src/services/agents.service.ts`
- `apps/api/src/controllers/agents/agents.controller.ts`
- `apps/api/src/modules/agents.module.ts`
- `apps/api/test/services/agents/agents.service.spec.ts`
- `apps/api/test/controllers/agents/agents.controller.spec.ts`
- `apps/api/test/__mocks__/nanoid.ts`
- `apps/api/prisma/migrations/20260217191137_add_agent_model/migration.sql`

**Modified files:**
- `apps/api/prisma/schema.prisma` — added `AgentStatus` enum, `Agent` model, `agents` relation on `Organization`
- `apps/api/src/common/logger/logger.module.ts` — registered `AgentLoggerService`
- `apps/api/src/modules/app.module.ts` — imported `AgentsModule`
- `packages/validation/src/index.ts` — added agent validation schemas
- `apps/api/package.json` — added `nanoid` dependency
- `apps/api/jest.config.cjs` — added nanoid mock in `moduleNameMapper`
- `bun.lock` — updated lockfile
