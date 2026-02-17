# Story 3.4: Implement Domain Allowlist Configuration

Status: done

> **Prerequisite:** Story 3-1 (Agent Model & Schema) must be complete — the `allowedDomains String[]` field already exists on the Agent model.

## Story

As an **admin/super admin**,
I want to configure allowed domains for an agent,
so that the chat widget only loads on authorized websites.

## Acceptance Criteria

1. **AC1:** `PATCH /agents/:id` accepts `allowedDomains` as a string array
2. **AC2:** Only `ADMIN` and `SUPER_ADMIN` can view/edit the domain allowlist (CLIENT users never see this field)
3. **AC3:** Domains are validated: stripped of protocol/path, lowercased, must be valid hostname or IP (with optional port)
4. **AC4:** Wildcard patterns supported: `*.example.com` matches any subdomain
5. **AC5:** Duplicate domains are silently deduplicated before storage
6. **AC6:** Empty array means the widget works on any domain (no restriction)
7. **AC7:** `localhost` and `localhost:*` are always allowed in `NODE_ENV=development` regardless of the list
8. **AC8:** `GET /agents/:id` returns `allowedDomains` only to ADMIN/SUPER_ADMIN users; CLIENT users get it stripped from response
9. **AC9:** Zod validation schema for domain format is defined in `@repo/validation`
10. **AC10:** Unit tests cover: valid domains, invalid formats, wildcard patterns, deduplication, role-based visibility

## Tasks / Subtasks

- [x] **Task 1: Zod Validation Schema** (AC: 1, 3, 4, 5, 9)
  - [x] 1.1 Add `domainSchema` to `packages/validation/src/index.ts` — validates single domain string
  - [x] 1.2 Add `allowedDomainsSchema` — `z.array(domainSchema).max(50)` with default `[]`
  - [x] 1.3 Extend `updateAgentSchema` to include `allowedDomains` as optional field
  - [x] 1.4 Export types via `apps/api/src/models/agent.dto.ts`

- [x] **Task 2: Domain Normalization Utility** (AC: 3, 4, 5)
  - [x] 2.1 Create `apps/api/src/utils/domain.ts`
  - [x] 2.2 `normalizeDomain(input: string): string` — strip protocol, path, trailing slash, lowercase
  - [x] 2.3 `isValidDomain(input: string): boolean` — validate hostname/IP/wildcard format
  - [x] 2.4 `deduplicateDomains(domains: string[]): string[]` — remove duplicates after normalization
  - [x] 2.5 Unit tests for the utility in `apps/api/test/utils/domain.spec.ts` — 26 tests passing

- [x] **Task 3: Service — Domain Update Logic** (AC: 1, 2, 5, 6)
  - [x] 3.1 In `AgentsService.update()`, normalize and deduplicate domains before saving
  - [x] 3.2 Log domain changes via `AgentLoggerService` (audit event: `AGENT_DOMAINS_UPDATED`)

- [x] **Task 4: Service — Response Filtering** (AC: 8)
  - [x] 4.1 In `AgentsService.findById()` and `findAll()`, strip `allowedDomains` from response when user is CLIENT
  - [x] 4.2 Create a private `stripSensitiveFields(agent, user)` helper in the service
  - [x] 4.3 Refactored `findById` into `findByIdRaw` (internal) + `findById` (public, applies filtering)

- [x] **Task 5: Unit Tests** (AC: 10)
  - [x] 5.1 Test domain normalization: `https://Example.COM/path` → `example.com`
  - [x] 5.2 Test wildcard format: `*.example.com` accepted, `**.example.com` rejected
  - [x] 5.3 Test deduplication: `['a.com', 'A.COM']` → `['a.com']`
  - [x] 5.4 Test CLIENT user does not receive `allowedDomains` in response
  - [x] 5.5 Test ADMIN/SUPER_ADMIN receive `allowedDomains` in response
  - [x] 5.6 Test empty array is valid (no domain restriction)
  - [x] 5.7 Test max 50 domains limit

## Dev Notes

### The `allowedDomains` field already exists

Story 3-1 created the Agent model with `allowedDomains String[]` in Prisma. This story adds the **validation, normalization, and role-based visibility** logic — no schema migration needed.

### Domain Normalization Utility

Create `apps/api/src/utils/domain.ts`:

```typescript
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .replace(/\/$/, '');
}

export function isValidDomain(input: string): boolean {
  const normalized = normalizeDomain(input);
  // Allow: localhost, localhost:3000, *.example.com, example.com, 192.168.1.1
  return /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?(:\d+)?$/.test(normalized)
    || /^localhost(:\d+)?$/.test(normalized)
    || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(normalized);
}

export function deduplicateDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  return domains.reduce<string[]>((acc, d) => {
    const n = normalizeDomain(d);
    if (n && !seen.has(n)) { seen.add(n); acc.push(n); }
    return acc;
  }, []);
}
```

### Zod Schema Addition

Add to `packages/validation/src/index.ts`:

```typescript
export const domainSchema = z.string()
  .min(1, 'Domain cannot be empty')
  .max(253, 'Domain too long')
  .transform(val => val.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, ''));

export const allowedDomainsSchema = z.array(domainSchema).max(50, 'Maximum 50 domains allowed').default([]);
```

Then extend `updateAgentSchema`:
```typescript
export const updateAgentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  allowedDomains: allowedDomainsSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
```

### Response Filtering Pattern

In the service, strip sensitive fields for CLIENT users:

```typescript
private stripSensitiveFields(agent: Agent, user: CurrentUserData) {
  if (user.role === Role.CLIENT) {
    const { allowedDomains, ...safe } = agent;
    return safe;
  }
  return agent;
}
```

Apply this in `findById()` and in `findAll()` mapped over results.

### Permission Model

| Action | SUPER_ADMIN | ADMIN | CLIENT |
|--------|:-----------:|:-----:|:------:|
| View allowedDomains | Yes | Yes | No (stripped) |
| Edit allowedDomains | Yes | Yes | No (field ignored) |

### File Structure

```
apps/api/src/utils/domain.ts                    # NEW
apps/api/test/utils/domain.spec.ts              # NEW
apps/api/src/services/agents.service.ts          # MODIFIED — domain normalization + response filtering
packages/validation/src/index.ts                 # MODIFIED — domain schemas
```

### References

- [Source: `AgentEditor/sections/IntegrationSettings.tsx`] — frontend domain management UI reference
- [Source: `_bmad-output/implementation-artifacts/3-1-implement-agent-model-and-schema.md`] — Agent model with `allowedDomains String[]`
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1333-1348] — Story 3.4 AC
- [Source: `apps/api/src/services/organizations.service.ts`] — service pattern reference

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Lint flagged unused destructured `allowedDomains` var — resolved with `eslint-disable-next-line`
- Type error from `findById` return type after adding `stripSensitiveFields` — resolved by introducing `findByIdRaw` private method

### Completion Notes List

- `domainSchema` and `allowedDomainsSchema` added to `@repo/validation`
- Domain normalization utility with 26 passing tests
- `stripSensitiveFields` strips `allowedDomains` for CLIENT users across `findById`, `findAll`, and `update`
- `findByIdRaw` private method added for internal use (update, softDelete need full Agent)
- Audit event `AGENT_DOMAINS_UPDATED` fires on domain changes
- Combined with Story 3-7 in same branch for efficiency

### File List

- `packages/validation/src/index.ts` — MODIFIED (domainSchema, allowedDomainsSchema, updateAgentSchema)
- `apps/api/src/models/agent.dto.ts` — MODIFIED (re-export domainSchema, allowedDomainsSchema)
- `apps/api/src/utils/domain.ts` — NEW (normalizeDomain, isValidDomain, deduplicateDomains)
- `apps/api/src/services/agents.service.ts` — MODIFIED (domain normalization, response filtering, findByIdRaw)
- `apps/api/src/common/logger/agent.logger.ts` — MODIFIED (AGENT_DOMAINS_UPDATED event)
- `apps/api/test/utils/domain.spec.ts` — NEW (26 tests)
- `apps/api/test/services/agents/agents.service.spec.ts` — MODIFIED (domain + filtering tests)
- `apps/api/test/controllers/agents/agents.controller.spec.ts` — MODIFIED (domain validation tests)
