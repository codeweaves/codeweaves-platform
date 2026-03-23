# Story 13.1: Agent Chat Trigger URL — Schema & API

Status: ready-for-dev

## Story

As a **platform admin**,
I want to configure a Chat Trigger URL on each agent (in addition to the existing webhook URL),
So that the backend can use real n8n streaming when a Chat Trigger URL is available.

## Acceptance Criteria

1. A new nullable `chatTriggerUrl` column exists on the `AgentSecret` model (alongside existing `webhookUrl`)
2. Prisma schema updated, migration generated and applied
3. Agent API exposes `chatTriggerUrl` via dedicated PATCH/GET endpoints (mirroring webhook pattern)
4. Validation ensures it's a valid HTTPS URL if provided (same production-only HTTPS enforcement as webhook)
5. `chatTriggerUrl` is encrypted before storage (same CryptoService pattern as `webhookUrl`)
6. Existing agents have `chatTriggerUrl` as null (backward compatible, no data migration needed)
7. A `getChatTriggerUrl(agentId)` method is added to `AgentsService` for use by chat service
8. Unit tests cover the new schema field, service methods, and controller endpoints

## Tasks / Subtasks

- [ ] Task 1: Prisma schema + migration (AC: 1, 2, 6)
  - [ ] Add `chatTriggerUrl String? @db.Text` to `AgentSecret` model in `apps/api/prisma/schema.prisma`
  - [ ] Generate migration: `bunx prisma migrate dev --name add_chat_trigger_url`
  - [ ] Verify migration SQL adds nullable column with no default

- [ ] Task 2: Validation schema (AC: 4)
  - [ ] Add `updateChatTriggerSchema` in `packages/validation/src/index.ts` next to `updateWebhookSchema`
  - [ ] Schema: `z.object({ chatTriggerUrl: z.string().url('Must be a valid URL') })`
  - [ ] Export from package

- [ ] Task 3: Service methods (AC: 3, 5, 7)
  - [ ] Add `setChatTriggerUrl(agentId, chatTriggerUrl, userId)` to `agents.service.ts`
  - [ ] Add `getChatTriggerUrl(agentId)` to `agents.service.ts`
  - [ ] Add `getEffectiveChatTriggerUrl(agentId)` for internal use (returns null if not set, no fallback)
  - [ ] Follow exact same pattern as `setWebhookUrl()` / `getWebhookUrl()` (encryption, HTTPS enforcement, audit logging)

- [ ] Task 4: Controller endpoints (AC: 3)
  - [ ] Add `PATCH /agents/:id/chat-trigger` — set chat trigger URL
  - [ ] Add `GET /agents/:id/chat-trigger` — get chat trigger URL
  - [ ] Both require ADMIN or SUPER_ADMIN role (same as webhook endpoints)
  - [ ] Add to `agents.controller.ts` after existing webhook endpoints

- [ ] Task 5: Unit tests (AC: 8)
  - [ ] Add tests in `apps/api/test/services/agents/agents.service.spec.ts` for new methods
  - [ ] Add tests in `apps/api/test/controllers/agents/agents.controller.spec.ts` for new endpoints
  - [ ] Cover: set URL, get URL, HTTPS enforcement, encryption, null handling, role authorization

## Dev Notes

### Critical: webhookUrl Lives in AgentSecret, NOT Agent

The `webhookUrl` is stored in the `AgentSecret` model (one-to-one with Agent), NOT on the Agent model directly. The `chatTriggerUrl` MUST follow the same pattern — add it to `AgentSecret`.

**AgentSecret model** (`apps/api/prisma/schema.prisma`, lines 126-137):
```prisma
model AgentSecret {
  id              String   @id @default(uuid())
  agentId         String   @unique
  agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  webhookUrl      String?  @db.Text
  chatTriggerUrl  String?  @db.Text   // ← ADD THIS
  apiKey          String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([agentId])
  @@map("agent_secrets")
}
```

### Existing Webhook Pattern to Mirror

**Service** (`apps/api/src/services/agents.service.ts`):
- `setWebhookUrl()` (lines 317-348): Encrypts URL → upserts AgentSecret → logs audit event
- `getWebhookUrl()` (lines 350-367): Finds AgentSecret → decrypts → returns `{ webhookUrl, isFallback? }`
- `getEffectiveWebhookUrl()` (lines 372-386): Internal method, falls back to `DEFAULT_WEBHOOK_URL` env var

For `chatTriggerUrl`:
- `setChatTriggerUrl()` — same encrypt + upsert pattern, same HTTPS enforcement in production
- `getChatTriggerUrl()` — same decrypt pattern, but **NO fallback** (returns null if not set)
- `getEffectiveChatTriggerUrl()` — returns decrypted URL or null (no env var fallback)

**Controller** (`apps/api/src/controllers/agents/agents.controller.ts`):
- Webhook endpoints at lines 122-172: PATCH, GET, POST (test)
- Chat trigger needs only PATCH and GET (no test endpoint needed for now)
- Same role guards: `@Roles(Role.ADMIN, Role.SUPER_ADMIN)`

**Validation** (`packages/validation/src/index.ts`):
- `updateWebhookSchema` (lines 215-217): `z.object({ webhookUrl: z.string().url() })`
- Add `updateChatTriggerSchema`: `z.object({ chatTriggerUrl: z.string().url() })`

### HTTPS Enforcement

Production HTTPS check in `setWebhookUrl()` (line 323):
```typescript
if (this.configService.get('NODE_ENV') === 'production' && !webhookUrl.startsWith('https://')) {
  throw new BadRequestException('Webhook URL must use HTTPS in production');
}
```
Apply identical check in `setChatTriggerUrl()`.

### Encryption Pattern

```typescript
// Encrypt before storage
const encryptedUrl = this.cryptoService.encrypt(chatTriggerUrl);

// Upsert AgentSecret
await this.prisma.agentSecret.upsert({
  where: { agentId },
  create: { agentId, chatTriggerUrl: encryptedUrl },
  update: { chatTriggerUrl: encryptedUrl },
});

// Decrypt on retrieval
const decryptedUrl = this.cryptoService.decrypt(secret.chatTriggerUrl);
```

### Audit Logging

Follow existing pattern from `setWebhookUrl()` (lines 341-345):
```typescript
this.agentLogger.logSecretEvent(agentId, userId, isNew ? 'created' : 'updated', 'chatTriggerUrl');
```

### Frontend Integration (Story 13-2 — NOT this story)

This story is backend-only. The dashboard UI for the chatTriggerUrl field is Story 13-2. However, the API contract established here will be consumed by:
- `apps/web/app/(protected)/dashboard/agents/[id]/page.tsx` — will fetch chatTriggerUrl
- `apps/web/components/features/agents/agent-editor/sections/integration-settings.tsx` — will render input
- `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx` — will PATCH on save

### Project Structure Notes

- Schema: `apps/api/prisma/schema.prisma` (AgentSecret model, ~line 126)
- Migration: `apps/api/prisma/migrations/` (auto-generated folder)
- Validation: `packages/validation/src/index.ts` (near line 215)
- Service: `apps/api/src/services/agents.service.ts` (add after line 386)
- Controller: `apps/api/src/controllers/agents/agents.controller.ts` (add after line 172)
- DTO re-export: `apps/api/src/models/agent.dto.ts` (add new schema export)
- Tests: `apps/api/test/services/agents/agents.service.spec.ts` and `apps/api/test/controllers/agents/agents.controller.spec.ts`

### Testing Patterns

Follow existing agent test patterns:
- **Service tests** (`agents.service.spec.ts`): Mock PrismaService, CryptoService, ConfigService, AgentLoggerService
- **Controller tests** (`agents.controller.spec.ts`): Override guards, mock service methods
- Test data: Reuse existing `mockAgent`, `mockUser` fixtures
- Cover: success path, HTTPS enforcement, encryption calls, null/missing secret, role authorization

### References

- [Source: architecture.md#ADR-013] — Streaming Pipeline decision, two URLs per agent
- [Source: architecture.md#Section 12.1] — Dual-mode streaming based on chatTriggerUrl presence
- [Source: architecture.md#Section 13.2] — n8n provider branching on chatTriggerUrl
- [Source: agents.service.ts#317-386] — Existing webhook methods to mirror
- [Source: agents.controller.ts#122-172] — Existing webhook endpoints to mirror

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
