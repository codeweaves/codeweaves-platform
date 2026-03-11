# Story 11.4: HMAC Signature Verification (Webhook Security)

Status: done

## Story

As an **agent owner**,
I want optional HMAC signature verification on webhook responses,
so that responses from n8n can be validated as authentic and untampered.

## Acceptance Criteria

1. **Given** HMAC is enabled for an agent (via `hmacEnabled` flag on the Agent model), **When** a webhook response is received from n8n, **Then** the `X-Signature` header is validated using SHA-256 HMAC with the agent's secret key.
2. **Given** HMAC verification is optional, **When** an agent has `hmacEnabled=false` or no secret stored, **Then** webhook responses are accepted without signature verification.
3. **Given** a valid signature, **When** verified, **Then** the response is processed normally.
4. **Given** an invalid or missing signature (when HMAC is enabled), **When** verification fails, **Then** the response is rejected, a security warning is logged via TracerService, and a fallback error message is sent to the user.
5. **Given** the agent has a secret stored in AgentSecret, **When** HMAC verification needs the key, **Then** CryptoService decrypts the secret before use.
6. **Given** tests exist, **Then** unit tests cover: valid signature passes, invalid signature rejected, missing header rejected, HMAC disabled passthrough, decryption of agent secret.

## Tasks / Subtasks

- [x] **Task 1: Add `hmacEnabled` field to Agent model** (AC: #1, #2)
  - [x] 1.1 Add `hmacEnabled Boolean @default(false)` to the `Agent` model in `apps/api/prisma/schema.prisma`
  - [x] 1.2 Run `bunx prisma migrate dev --name add-hmac-enabled-to-agent`
  - [x] 1.3 Run `bunx prisma generate` to regenerate client

- [x] **Task 2: Create HmacService** (AC: #1, #3, #4)
  - [x] 2.1 Create `apps/api/src/common/security/hmac.service.ts`
  - [x] 2.2 Implement `verifySignature(payload: string, signature: string, secret: string): boolean`
  - [x] 2.3 Use `crypto.createHmac('sha256', secret).update(payload).digest('hex')`
  - [x] 2.4 Use timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing attacks

- [x] **Task 3: Create SecurityModule** (AC: #1)
  - [x] 3.1 Create `apps/api/src/common/security/security.module.ts`
  - [x] 3.2 Export `HmacService`
  - [x] 3.3 Register `SecurityModule` in `AppModule` imports (as a global module)

- [x] **Task 4: Update ChatService to verify HMAC on n8n responses** (AC: #1, #2, #3, #4, #5)
  - [x] 4.1 Inject `HmacService`, `CryptoService`, `PrismaService`, and `TracerService` into `ChatService`
  - [x] 4.2 In `callN8nWebhook`, after receiving the response, check if the agent has `hmacEnabled=true`
  - [x] 4.3 If HMAC is enabled, read the `X-Signature` header from the response
  - [x] 4.4 Fetch the agent's secret from `AgentSecret`, decrypt the `apiKey` field via `CryptoService`
  - [x] 4.5 Call `HmacService.verifySignature(responseBody, signature, decryptedSecret)`
  - [x] 4.6 If verification fails or header is missing, log security audit event via TracerService and throw `BadGatewayException` with fallback message
  - [x] 4.7 If `hmacEnabled=false` or no secret exists, skip verification entirely
  - [x] 4.8 Update `resolveAgent` or add a helper to fetch `hmacEnabled` and the agent's secret when needed

- [x] **Task 5: Log verification failures** (AC: #4)
  - [x] 5.1 Use `TracerService.logAuditEvent()` with event `HMAC_VERIFICATION_FAILED`
  - [x] 5.2 Include `agentId`, `sessionId`, and failure reason in the audit data (never log the secret or signature)

- [x] **Task 6: Unit tests** (AC: #6)
  - [x] 6.1 Create `apps/api/test/common/security/hmac.service.spec.ts`
  - [x] 6.2 Test valid signature returns `true`
  - [x] 6.3 Test invalid signature returns `false`
  - [x] 6.4 Test empty/missing signature returns `false`
  - [x] 6.5 Test HMAC computation matches expected value for known input
  - [x] 6.6 Test ChatService HMAC integration: hmacEnabled=true with valid signature passes
  - [x] 6.7 Test ChatService HMAC integration: hmacEnabled=true with invalid signature rejects and logs audit event
  - [x] 6.8 Test ChatService HMAC integration: hmacEnabled=true with missing X-Signature header rejects
  - [x] 6.9 Test ChatService HMAC integration: hmacEnabled=false skips verification
  - [x] 6.10 Test that CryptoService.decrypt is called to retrieve the secret

## Dev Notes

### Architecture Compliance

This story implements **NFR24: HMAC signature verification** and **FR111** from the architecture document. The HMAC verification is an **outbound verification** — we verify n8n's response to our POST request, not an inbound request to our API. This is important because the `X-Signature` header is on the HTTP response object, not a request header.

### Existing Patterns to Follow

**Global module pattern** — Follow `CryptoModule` and `TracerModule` for `SecurityModule`:
```typescript
// apps/api/src/common/security/security.module.ts
@Global()
@Module({
  providers: [HmacService],
  exports: [HmacService],
})
export class SecurityModule {}
```

**TracerService audit logging** — Follow the existing pattern in `apps/api/src/common/tracer/tracer.service.ts`:
```typescript
await this.tracerService.logAuditEvent(
  agentId,
  'HMAC_VERIFICATION_FAILED',
  { sessionId, reason: 'invalid_signature' },
);
```

**Agent secret access** — The `AgentSecret` model stores encrypted `apiKey` which will be used as the HMAC shared secret. Use `CryptoService.decrypt()` to get the raw key. The `AgentsService.getEffectiveWebhookUrl()` already demonstrates how to fetch and decrypt agent secrets.

**ChatService webhook flow** — The `callN8nWebhook` method in `apps/api/src/services/chat.service.ts` currently uses `fetch()` to POST to n8n and parses the JSON response. The HMAC check must happen after `response.json()` is called (we need the raw body for HMAC computation). Consider reading the response as text first (`response.text()`), computing HMAC on the raw text, then parsing as JSON.

### HmacService Implementation

```typescript
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class HmacService {
  /**
   * Verify an HMAC-SHA256 signature against a payload.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    if (!payload || !signature || !secret) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }

  /**
   * Compute an HMAC-SHA256 signature for a payload (useful for testing).
   */
  computeSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
```

### ChatService Integration Point

The key change to `callN8nWebhook` is:
1. Read response body as **text** first (not JSON) so we have the raw string for HMAC
2. If agent has `hmacEnabled=true`, verify `X-Signature` header against the raw body
3. Then parse the text as JSON and proceed as before

```typescript
// In callN8nWebhook — after receiving response:
const responseText = await response.text();

if (agentHmacEnabled) {
  const signature = response.headers.get('x-signature');
  const decryptedSecret = this.cryptoService.decrypt(agentSecret.apiKey);
  if (!signature || !this.hmacService.verifySignature(responseText, signature, decryptedSecret)) {
    await this.tracerService.logAuditEvent(agentId, 'HMAC_VERIFICATION_FAILED', { sessionId });
    throw new BadGatewayException('Response verification failed');
  }
}

const data = JSON.parse(responseText);
```

### What This Story Does NOT Include

- **Inbound webhook verification** — This story only verifies n8n responses (outbound). Inbound webhook signature verification (e.g., for Stripe, GitHub webhooks) is a future concern but HmacService is designed to be reusable for that.
- **UI for enabling HMAC** — The `hmacEnabled` flag is a database field only; UI toggle will be part of a future agent settings story.
- **n8n configuration** — The n8n workflow must be separately configured to sign responses with the shared secret. That is an ops/documentation task, not a code task.
- **Key rotation** — Changing the HMAC secret requires updating the AgentSecret record and the n8n workflow simultaneously. No automated rotation is included.

### Project Structure Notes

New files:
```
apps/api/src/common/security/
├── hmac.service.ts              # NEW — HMAC computation and verification
└── security.module.ts           # NEW — Global module exporting HmacService

apps/api/test/common/security/
└── hmac.service.spec.ts         # NEW — Unit tests for HmacService
```

Modified files:
```
apps/api/prisma/schema.prisma            # MODIFIED — add hmacEnabled to Agent model
apps/api/src/services/chat.service.ts    # MODIFIED — add HMAC verification to callN8nWebhook
apps/api/src/modules/app.module.ts       # MODIFIED — import SecurityModule
```

### Testing Approach

**HmacService tests** — Pure unit tests, no mocks needed. Use known HMAC values:
```typescript
const secret = 'test-secret-key';
const payload = '{"agentReply":"Hello"}';
const expected = createHmac('sha256', secret).update(payload).digest('hex');

expect(hmacService.verifySignature(payload, expected, secret)).toBe(true);
expect(hmacService.verifySignature(payload, 'wrong-sig', secret)).toBe(false);
```

**ChatService integration tests** — Mock `HmacService`, `CryptoService`, `TracerService`, and `PrismaService`. Verify:
- When `hmacEnabled=true` and signature is valid, response is processed
- When `hmacEnabled=true` and signature is invalid, `TracerService.logAuditEvent` is called and `BadGatewayException` is thrown
- When `hmacEnabled=false`, `HmacService.verifySignature` is never called

Follow existing test patterns from `apps/api/test/` directory.

### References

- [Source: `_bmad-output/planning-artifacts/architecture.md` — NFR24: HMAC signature verification]
- [Source: `_bmad-output/planning-artifacts/architecture.md` — FR111]
- [Source: `apps/api/src/services/chat.service.ts` — callN8nWebhook method, lines 187-241]
- [Source: `apps/api/src/common/crypto/crypto.service.ts` — CryptoService encrypt/decrypt]
- [Source: `apps/api/src/common/tracer/tracer.service.ts` — TracerService.logAuditEvent pattern]
- [Source: `apps/api/prisma/schema.prisma` — Agent model (line 100), AgentSecret model (line 123)]
- [Source: Story 3-5 — AgentSecret model and CryptoService creation]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- All 1005 tests passing (54 suites), zero regressions
- chat.service.ts at 100% statement coverage
- Lint, type-check, and build all pass clean

### Completion Notes List
- Task 1: Added `hmacEnabled Boolean @default(false)` to Agent model. Migration `20260311045307_add_hmac_enabled_to_agent` applied.
- Task 2: Created HmacService with `verifySignature` (timing-safe comparison via `crypto.timingSafeEqual`) and `computeSignature` methods.
- Task 3: Created SecurityModule as @Global() module, registered in AppModule.
- Task 4: Updated ChatService — injected HmacService, CryptoService, TracerService. Modified `callN8nWebhook` to read response as text first (for HMAC computation), verify X-Signature header when hmacEnabled=true, then parse JSON. Added `verifyHmacSignature` and `getAgentHmacSecret` private methods. Updated `resolveAgent` select to include `hmacEnabled`.
- Task 5: HMAC verification failures logged via `TracerService.logAuditEvent` with event `HMAC_VERIFICATION_FAILED` and reasons: `invalid_signature`, `missing_signature_header`. Secrets/signatures never logged.
- Task 6: 17 HmacService unit tests (pure, no mocks) + 15 new HMAC ChatService integration tests added to existing spec. All 81 tests in chat.service.spec.ts pass.
- Code Review Fixes: (H1) AC#2 compliance — no secret → passthrough instead of reject. (M1) try/catch in `timingSafeEqual` for malformed hex signatures. (M2) Added malformed hex signature tests. (L2) Refactored `verifyHmacSignature` to accept signature string instead of full Response.

### Change Log
- 2026-03-11: Implemented HMAC signature verification for webhook security (story 11-4)
- 2026-03-11: Fixed code review findings — AC#2 compliance, malformed hex handling, reduced coupling

### File List
- `apps/api/prisma/schema.prisma` — MODIFIED (added hmacEnabled to Agent model)
- `apps/api/prisma/migrations/20260311045307_add_hmac_enabled_to_agent/migration.sql` — NEW
- `apps/api/src/common/security/hmac.service.ts` — NEW
- `apps/api/src/common/security/security.module.ts` — NEW
- `apps/api/src/modules/app.module.ts` — MODIFIED (added SecurityModule import)
- `apps/api/src/services/chat.service.ts` — MODIFIED (HMAC verification in callN8nWebhook)
- `apps/api/test/common/security/hmac.service.spec.ts` — NEW
- `apps/api/test/services/chat/chat.service.spec.ts` — MODIFIED (added HMAC test cases, updated mocks)
