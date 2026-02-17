# Story 3.6: Implement Webhook URL Configuration

Status: done

> **Prerequisites:** Story 3-1 (Agent Model), Story 3-5 (AgentSecret + CryptoService) must be complete.

## Story

As an **admin/super admin**,
I want to configure a webhook URL for an agent,
so that chat messages are forwarded to my n8n workflow for AI processing.

## Acceptance Criteria

1. **AC1:** `PATCH /agents/:id/webhook` accepts `webhookUrl` string — ADMIN/SUPER_ADMIN only
2. **AC2:** URL is validated: must be HTTPS in production, HTTP allowed in development
3. **AC3:** URL is encrypted via `CryptoService` before storage in `AgentSecret.webhookUrl`
4. **AC4:** `GET /agents/:id/webhook` returns the decrypted URL — ADMIN/SUPER_ADMIN only
5. **AC5:** CLIENT users cannot access webhook endpoints at all (403)
6. **AC6:** A test button endpoint `POST /agents/:id/webhook/test` sends a test ping and returns success/failure
7. **AC7:** If no agent-specific webhook is set, the system falls back to `DEFAULT_WEBHOOK_URL` env var
8. **AC8:** Webhook URL change is audit-logged (without logging the actual URL value)
9. **AC9:** Zod validation schema for webhook URL is defined in `@repo/validation`
10. **AC10:** Unit tests cover: URL validation, encryption storage, role access, test ping, fallback behavior

## Tasks / Subtasks

- [x] **Task 1: Zod Validation Schema** (AC: 2, 9)
  - [x] 1.1 Add `updateWebhookSchema` to `packages/validation/src/index.ts`
  - [x] 1.2 Schema validates: must be valid URL; HTTPS enforcement in service layer based on NODE_ENV
  - [x] 1.3 Add `updateWebhookSchema` — `z.object({ webhookUrl: z.string().url() })`
  - [x] 1.4 Export types via `agent.dto.ts`

- [x] **Task 2: Webhook Endpoints** (AC: 1, 4, 5, 6)
  - [x] 2.1 Add to `AgentsController`: `PATCH /agents/:id/webhook` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN)`
  - [x] 2.2 Add to `AgentsController`: `GET /agents/:id/webhook` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN)`
  - [x] 2.3 Add to `AgentsController`: `POST /agents/:id/webhook/test` — `@Roles(Role.ADMIN, Role.SUPER_ADMIN)`
  - [x] 2.4 Full Swagger documentation on all endpoints

- [x] **Task 3: Service — Webhook CRUD** (AC: 1, 3, 4, 7, 8)
  - [x] 3.1 Implement `setWebhookUrl(agentId, webhookUrl, user)` in `AgentsService`
  - [x] 3.2 Encrypt via `CryptoService.encrypt()` before upsert to `AgentSecret`
  - [x] 3.3 Implement `getWebhookUrl(agentId, user)` — decrypt and return, or return fallback
  - [x] 3.4 Implement `getEffectiveWebhookUrl(agentId)` — for internal use (resolves fallback)
  - [x] 3.5 Audit log: `AGENT_WEBHOOK_UPDATED` (do NOT log the URL value)

- [x] **Task 4: Service — Webhook Test** (AC: 6)
  - [x] 4.1 Implement `testWebhook(agentId, user)` — sends POST to webhook with test payload
  - [x] 4.2 Test payload: `{ type: 'test', agentId, timestamp }`
  - [x] 4.3 Return `{ success: boolean, statusCode, responseTime }` — timeout after 10 seconds
  - [x] 4.4 Use Node.js native `fetch` (available in Node 18+)

- [x] **Task 5: Environment Configuration** (AC: 7)
  - [x] 5.1 Add `DEFAULT_WEBHOOK_URL` to `.env.example`
  - [ ] 5.2 Add to env validation schema (deferred — optional env var)

- [x] **Task 6: Unit Tests** (AC: 10)
  - [x] 6.1 Test: ADMIN can set webhook URL → stored encrypted in AgentSecret
  - [x] 6.2 Test: ADMIN can get webhook URL → returns decrypted value
  - [x] 6.3 Test: CLIENT cannot access webhook endpoints → role decorators tested
  - [x] 6.4 Test: HTTPS validation in production mode
  - [x] 6.5 Test: HTTP allowed in development mode
  - [x] 6.6 Test: Fallback to DEFAULT_WEBHOOK_URL when agent has no webhook
  - [x] 6.7 Test: Test ping validation (NotFoundException when no webhook)
  - [x] 6.8 Test: Webhook URL change triggers audit log without URL in log data

## Dev Notes

### Webhook Endpoints on AgentsController

These are sub-routes on the existing agents controller:

```typescript
@Patch(':id/webhook')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiOperation({ summary: 'Set agent webhook URL' })
async setWebhook(
  @Param('id', ParseUUIDPipe) id: string,
  @Body(new ZodValidationPipe(updateWebhookSchema)) dto: UpdateWebhookDto,
  @CurrentUser() user: CurrentUserData,
) {
  return this.agentsService.setWebhookUrl(id, dto.webhookUrl, user);
}

@Get(':id/webhook')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiOperation({ summary: 'Get agent webhook URL (decrypted)' })
async getWebhook(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: CurrentUserData,
) {
  return this.agentsService.getWebhookUrl(id, user);
}

@Post(':id/webhook/test')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiOperation({ summary: 'Test agent webhook connectivity' })
async testWebhook(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user: CurrentUserData,
) {
  return this.agentsService.testWebhook(id, user);
}
```

### Validation Schema

Add to `packages/validation/src/index.ts`:

```typescript
export const updateWebhookSchema = z.object({
  webhookUrl: z.string().url('Must be a valid URL'),
});

export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;
```

HTTPS enforcement is done in the service layer based on `NODE_ENV`, not in the schema.

### Service — Encryption & Fallback

```typescript
async setWebhookUrl(agentId: string, webhookUrl: string, user: CurrentUserData) {
  // Validate HTTPS in production
  if (process.env.NODE_ENV === 'production' && !webhookUrl.startsWith('https://')) {
    throw new BadRequestException('Webhook URL must use HTTPS in production');
  }

  const encrypted = this.cryptoService.encrypt(webhookUrl);
  await this.prisma.agentSecret.upsert({
    where: { agentId },
    create: { agentId, webhookUrl: encrypted },
    update: { webhookUrl: encrypted },
  });

  await this.logger.logWebhookUpdated(agentId);
  return { message: 'Webhook URL updated' };
}

async getEffectiveWebhookUrl(agentId: string): Promise<string> {
  const secret = await this.prisma.agentSecret.findUnique({ where: { agentId } });
  if (secret?.webhookUrl) return this.cryptoService.decrypt(secret.webhookUrl);
  const fallback = this.configService.get<string>('DEFAULT_WEBHOOK_URL');
  if (!fallback) throw new NotFoundException('No webhook URL configured');
  return fallback;
}
```

### Security Rules

- **NEVER** return the webhook URL in general agent GET/list responses
- **NEVER** log the actual webhook URL in audit logs
- Webhook is only accessible via dedicated `/webhook` sub-endpoints
- Only ADMIN/SUPER_ADMIN can access these endpoints — no CLIENT access at all

### Permission Model

| Action | SUPER_ADMIN | ADMIN | CLIENT |
|--------|:-----------:|:-----:|:------:|
| View webhook URL | Yes | Yes | No (403) |
| Set webhook URL | Yes | Yes | No (403) |
| Test webhook | Yes | Yes | No (403) |

### File Structure

```
packages/validation/src/index.ts                       # MODIFIED — webhook schemas
apps/api/src/controllers/agents/agents.controller.ts   # MODIFIED — webhook endpoints
apps/api/src/services/agents.service.ts                # MODIFIED — webhook CRUD + test
apps/api/src/common/logger/agent.logger.ts             # MODIFIED — webhook audit events
.env.example                                           # MODIFIED — DEFAULT_WEBHOOK_URL
apps/api/test/services/agents/agents.service.spec.ts   # MODIFIED — webhook tests
apps/api/test/controllers/agents/agents.controller.spec.ts # MODIFIED — webhook endpoint tests
```

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1369-1384] — Story 3.6 AC
- [Source: `_bmad-output/implementation-artifacts/3-5-create-agentsecret-model-for-sensitive-data.md`] — CryptoService
- [Source: `AgentEditor/sections/IntegrationSettings.tsx`] — webhook URL field UI reference
- [Source: `apps/api/src/controllers/organizations/organizations.controller.ts`] — controller pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Completion Notes List

- HTTPS enforcement is in the service layer (based on NODE_ENV), not in the Zod schema
- Webhook audit logging never includes the actual URL value — only event type + userId
- `getWebhookUrl` returns `{ isFallback: true }` when using DEFAULT_WEBHOOK_URL
- `testWebhook` uses AbortSignal.timeout(10_000) for 10s timeout

### File List

- `packages/validation/src/index.ts` — MODIFIED (updateWebhookSchema, UpdateWebhookDto)
- `apps/api/src/models/agent.dto.ts` — MODIFIED (re-export webhook schema + type)
- `apps/api/src/controllers/agents/agents.controller.ts` — MODIFIED (3 webhook endpoints)
- `apps/api/src/services/agents.service.ts` — MODIFIED (setWebhookUrl, getWebhookUrl, getEffectiveWebhookUrl, testWebhook)
- `apps/api/src/common/logger/agent.logger.ts` — MODIFIED (logWebhookUpdated)
- `apps/api/.env.example` — MODIFIED (DEFAULT_WEBHOOK_URL)
- `apps/api/test/services/agents/agents.service.spec.ts` — MODIFIED (webhook service tests)
- `apps/api/test/controllers/agents/agents.controller.spec.ts` — MODIFIED (webhook endpoint + validation tests)
