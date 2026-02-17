# Story 3.7: Create Agent Status Management

Status: ready-for-dev

> **Prerequisite:** Story 3-1 (Agent Model & Schema) must be complete — the `status AgentStatus` field and enum already exist.

## Story

As an **agent owner**,
I want to activate/deactivate my agents,
so that I can control when they are available to end users on the widget.

## Acceptance Criteria

1. **AC1:** `PATCH /agents/:id` accepts `status` field with value `ACTIVE` or `INACTIVE`
2. **AC2:** ADMIN and SUPER_ADMIN can toggle any agent's status
3. **AC3:** CLIENT users can toggle status only for agents in their own organization
4. **AC4:** Status change is audit-logged with `AGENT_STATUS_CHANGED` event (includes old → new status)
5. **AC5:** Widget API returns 503 when querying an `INACTIVE` agent (implemented as service method for future use)
6. **AC6:** Bulk status change is NOT supported — one agent at a time only
7. **AC7:** Zod validation ensures `status` is one of the enum values
8. **AC8:** Unit tests cover: status toggle, role-based access, org scoping for CLIENT, audit logging

## Tasks / Subtasks

- [ ] **Task 1: Validation Schema Update** (AC: 1, 7)
  - [ ] 1.1 Ensure `updateAgentSchema` in `@repo/validation` includes `status: z.enum(['ACTIVE', 'INACTIVE']).optional()`
  - [ ] 1.2 This may already be partially done in 3-1 — verify and extend if needed

- [ ] **Task 2: Service — Status Toggle** (AC: 1, 2, 3, 4, 5)
  - [ ] 2.1 In `AgentsService.update()`, handle `status` field — log old vs new status
  - [ ] 2.2 Audit log event: `AGENT_STATUS_CHANGED` with `{ oldStatus, newStatus }` in data
  - [ ] 2.3 Add `checkAgentActive(agentId): boolean` method — for future widget API use
  - [ ] 2.4 Org-scoping: CLIENT can only update agents in their own org

- [ ] **Task 3: Unit Tests** (AC: 8)
  - [ ] 3.1 Test: ADMIN toggles agent ACTIVE → INACTIVE → audit logged
  - [ ] 3.2 Test: CLIENT toggles own org agent status — succeeds
  - [ ] 3.3 Test: CLIENT toggles other org agent status — 403
  - [ ] 3.4 Test: `checkAgentActive` returns false for INACTIVE agents
  - [ ] 3.5 Test: Invalid status value rejected by validation

## Dev Notes

### Status is already in the update schema

Story 3-1 defined `updateAgentSchema` with `name` optional. This story ensures `status` is also included. The `updateAgentSchema` should become:

```typescript
export const updateAgentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  allowedDomains: allowedDomainsSchema.optional(),  // from story 3-4
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
```

> **Note:** If 3-4 runs before 3-7, `allowedDomains` will already be there. If 3-7 runs first, just add `status`. The dev agent should check what's currently in the schema.

### Audit Logging Pattern

```typescript
// In AgentsService.update()
if (dto.status && dto.status !== existingAgent.status) {
  await this.logger.logStatusChanged(agent.id, {
    oldStatus: existingAgent.status,
    newStatus: dto.status,
  });
}
```

Add to `AgentLoggerService`:

```typescript
async logStatusChanged(agentId: string, data: { oldStatus: string; newStatus: string }) {
  await this.tracer.logAuditEvent(agentId, 'AGENT_STATUS_CHANGED', data);
}
```

### Widget API Helper

For future use by the widget/chat API (Epic 5/6), add a simple check:

```typescript
async checkAgentActive(agentId: string): Promise<boolean> {
  const agent = await this.prisma.agent.findFirst({
    where: { id: agentId, deletedAt: null },
    select: { status: true },
  });
  return agent?.status === 'ACTIVE';
}
```

### Permission Model

| Action | SUPER_ADMIN | ADMIN | CLIENT |
|--------|:-----------:|:-----:|:------:|
| Toggle status (any org) | Yes | Yes | No |
| Toggle status (own org) | N/A | N/A | Yes |

### This is a small story

Most of the infrastructure (Agent model, service, controller, roles) exists from 3-1. This story is primarily about:
1. Ensuring `status` is in the update schema
2. Adding audit logging for status changes
3. Adding the `checkAgentActive` helper
4. Writing targeted tests

### File Structure

```
packages/validation/src/index.ts                       # MODIFIED — ensure status in updateAgentSchema
apps/api/src/services/agents.service.ts                # MODIFIED — status audit + checkAgentActive
apps/api/src/common/logger/agent.logger.ts             # MODIFIED — AGENT_STATUS_CHANGED event
apps/api/test/services/agents/agents.service.spec.ts   # MODIFIED — status tests
```

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1387-1401] — Story 3.7 AC
- [Source: `_bmad-output/implementation-artifacts/3-1-implement-agent-model-and-schema.md`] — Agent model with AgentStatus enum
- [Source: `apps/api/src/common/logger/organization.logger.ts`] — logger pattern

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
