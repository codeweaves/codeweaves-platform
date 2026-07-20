# Cross-Tenant IDOR / Object-Level Authorization Audit — Klivo / CodeWeaves Platform

**Date:** 2026-07-12
**Scope:** `apps/api` (NestJS) — every HTTP controller + the Socket.io gateway, traced controller → service → Prisma/SQL query.
**Focus:** Broken object-level authorization (BOLA/IDOR) — can a caller reach another tenant's data by supplying an id they don't own? Plus adjacent privilege-escalation and missing-auth on sensitive endpoints.
**Method:** Five parallel review passes by domain (agents/sub-resources; conversations/analytics; orgs/members/invitations; handover/chat/realtime/WebSocket; integrations/RAG/WhatsApp/voice/internal). Every Critical/High finding independently re-verified by reading the cited source directly.

> **Relationship to the [2026-05-31 audit](./security-compliance-audit-2026-05-31.md).** That audit's **F1** (cross-tenant IDOR on agent-knowledge endpoints) is now **fixed** — the `assertAgentAccessible()` helper is applied consistently across agent sub-resources. This pass re-verified that fix held *and* went deeper on the full object surface. The findings below are **new** and not covered by the earlier report.

> **Confidence.** Findings marked ✅ **VERIFIED** were confirmed by reading the cited source directly. All Critical/High items here are VERIFIED.

---

## 1. The tenancy model (how isolation is supposed to work)

Understanding this is prerequisite to reading the findings:

- **Global guards** (in order): `JwtAuthGuard` (rejects unauthenticated requests unless the route/controller has `@Public()`) → `UserSyncGuard` (attaches `request.user = { id, role, organizationId, clerkId }`) → `RateLimitGuard`.
- **`RolesGuard` is per-controller** (`@UseGuards(RolesGuard)`), and it **only checks *role*** via `@Roles(...)` / `@RequirePermission(...)`. It does **not** enforce tenant ownership. A route with neither decorator allows any authenticated user.
- **Tenancy is enforced in the service/query layer**, via `buildTenantFilter(user)` (list queries) or `assertAgentAccessible(prisma, agentId, user)` (`:agentId` sub-resources). Both scope `CLIENT` to their own `organizationId` and let `ADMIN`/`SUPER_ADMIN` (platform staff) go cross-org by design.
- **Public endpoints** (widget/chat) have no user; their model is **"the unguessable `sessionId`/`publicId` is the bearer token."**

**An IDOR therefore exists wherever an endpoint takes a resource id and the underlying query is not scoped to the caller's org** (e.g. `findUnique({ where: { id } })` with no `organizationId` and no `assertAgentAccessible`).

---

## 2. Executive summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| I1 | 🔴 CRITICAL | **WebSocket gateway has no authentication** — rooms joined from unauthenticated handshake `orgId`/`platform` flags ✅ VERIFIED | `gateways/handover.gateway.ts:52-74` |
| I2 | 🔴 CRITICAL | **`FilesService.deleteFile` doesn't scope the `fileId`** — cross-tenant file deletion ✅ VERIFIED | `services/files.service.ts:114-116` |
| I3 | 🟠 HIGH (conditional) | **Invitation acceptance trusts the email claim** — no `email_verified` check, no token binding → org/role escalation ✅ VERIFIED | `strategies/jwt.strategy.ts:39-44`, `services/users.service.ts:167-197` |
| I4 | 🟡 MED (HIGH if misconfigured) | **Dev-AI controller gated only by `NODE_ENV === 'production'` string** — public cross-org conversation read if env misset ✅ VERIFIED | `controllers/dev/dev-ai.controller.ts:413-418` |
| I5 | 🟡 MED | **`AgentDataFieldsController` missing `@UseGuards(RolesGuard)`** — admin-only `@Roles` are dead decorators ✅ VERIFIED | `controllers/agents/agent-data-fields.controller.ts:33-35` |
| I6 | 🟡 MED | **`POST /invitations/reissue` is public** — gated only by reissue token + count cap (matches parked backlog item) | `controllers/invitations/invitations.controller.ts:111` |
| I7 | 🔵 LOW | `GET /invitations/validate/:token` echoes `organizationId` + `role` pre-auth | `services/invitations.service.ts:226` |
| I8 | 🔵 LOW | `POST /invitations` body skips `ZodValidationPipe` — schema refinements unenforced | `controllers/invitations/invitations.controller.ts:42` |
| I9 | 🟡 MED (availability) | **`GET /agents/:id/editor-config` gated to ADMIN/SUPER_ADMIN as a whole** — a CLIENT can't load their own agent editor ("Agent not found"); it was over-gated to avoid leaking `webhookUrl`/`dataFields` in the bundle. Found live 2026-07-20 (pre-existing). | `controllers/agents/agents.controller.ts:117-118` |

---

## 3. Detailed findings

### I1 — 🔴 CRITICAL — WebSocket gateway has no authentication ✅ VERIFIED

**Location:** `apps/api/src/gateways/handover.gateway.ts:52-74` (`handleConnection`)

`handleConnection` joins rooms purely from **client-supplied, unauthenticated** handshake values:

```ts
const orgId = pickStr(h.auth?.orgId) ?? pickStr(h.query?.orgId);
const platform = h.auth?.platform === true || h.query?.platform === 'true';
if (orgId)   { client.data.orgId = orgId; void client.join(orgRoom(orgId)); }
if (platform){ client.data.platform = true; void client.join(PLATFORM_ROOM); }
```

There is **no socket authentication anywhere**: `RedisIoAdapter` (`common/ws/redis-io.adapter.ts`) only wires Redis fan-out and overrides no `allowRequest`; the global `JwtAuthGuard` is HTTP-only. The gateway's own class doc concedes org↔identity validation is a not-yet-built "Phase 3."

**Exploit chain (→ I-poll):**
1. Attacker connects with `auth: { platform: true }` → joins `PLATFORM_ROOM`. **No knowledge of any org required.**
2. Every `emitMessage` / `emitHandover` broadcast to that room carries the public `sessionId` (`gateway.ts:141-145`), for **every org on the platform**.
3. Attacker feeds each harvested `sessionId` to the public `GET /public/chat/:sessionId/poll` endpoint (`public-chat.controller.ts:153`), which treats `sessionId` as a bearer token and returns that session's full message content.
4. Result: **unauthenticated read of every conversation (visitor + human-agent messages) across all tenants.** The `auth: { orgId: '<victim-uuid>' }` variant targets a single org.

> Note: the public `/poll` endpoint is *safe in isolation* — `sessionId` is an unguessable `randomUUID()`. It becomes catastrophic only because I1 leaks those sessionIds to the wrong tenant. The fix is to close I1, not to change `/poll`.

**Fix:** Authenticate the Socket.io handshake — verify the Clerk JWT (custom `IoAdapter.allowRequest`, or in `handleConnection`), derive `orgId`/`role` from the **verified** token, and **ignore any client-supplied `orgId`/`platform`**. Reject joining any `org:`/`platform`/`session:` room the authenticated principal doesn't own; only `ADMIN`/`SUPER_ADMIN` may join `PLATFORM_ROOM`. The widget's session-scoped path (join `session:<unguessable-sessionId>`) is acceptable under the bearer model and can remain.

---

### I2 — 🔴 CRITICAL — `deleteFile` doesn't scope the fileId ✅ VERIFIED

**Location:** `apps/api/src/services/files.service.ts:111-129`

```ts
async deleteFile(fileId: string, agentId: string, user: CurrentUserData) {
  await this.ensureAgentAccess(agentId, user);          // proves caller owns SOME agent
  const file = await this.prisma.file.findUnique({       // ← fileId NOT scoped
    where: { id: fileId },
  });
  ...
  await this.storage.remove(file.bucket, [file.storageKey]);   // deletes from Supabase Storage
  await this.prisma.file.delete({ where: { id: fileId } });     // deletes DB row
}
```

`ensureAgentAccess(agentId)` only proves the caller owns *an* agent in their own org. The `fileId` is then resolved with an **unscoped `findUnique`** — no `organizationId`, no correlation to `agentId`. Route is CLIENT-reachable (`agent-files.controller.ts`, `@Roles(...CLIENT)`).

**Exploit:** A CLIENT in org A passes their own valid `agentId` (passes the access check) + a leaked/guessed `fileId` from org B → the service deletes org B's file from **both** storage and the DB. Cross-tenant destructive write.

**Fix:** Tie the file to the verified agent:
```ts
const file = await this.prisma.file.findFirst({
  where: { id: fileId, entityId: agentId },   // (or organizationId from the verified agent)
});
if (!file) throw new NotFoundException('File not found');
```

---

### I3 — 🟠 HIGH (conditional) — Invitation acceptance trusts the email claim ✅ VERIFIED

**Location:** `apps/api/src/strategies/jwt.strategy.ts:39-44`, `apps/api/src/services/users.service.ts:167-197`

`jwt.strategy.validate()` copies `payload.email` verbatim — there is **no `email_verified` check** (the claim isn't even in `JwtPayload`). On first login, `createFromInvitation` matches a pending invite by **email alone** and provisions the user with the invite's `role` and `organizationId`:

```ts
const invitation = await this.prisma.userInvitation.findFirst({
  where: { email, status: PENDING, expiresAt: { gt: new Date() } },
});
...
await tx.user.create({ data: {
  clerkId: jwtUser.clerkId, email,
  role: invitation.role,                 // ← granted from invite
  organizationId: invitation.organizationId,
}});
```

No invitation token/id is validated at acceptance — binding is purely the email string.

**Exploit (conditional):** If a Clerk account can obtain a session token carrying an `email` claim matching a pending invite **without that email being verified**, first login auto-provisions the attacker into that invite's org **and role** — including an `ADMIN`/`SUPER_ADMIN` invite (platform-wide escalation) or a `CLIENT` invite (join an arbitrary target org).

**Exploitability** hinges on whether the Clerk instance can mint a token for an unverified email. Clerk verifies email on signup by default, so this is likely not exploitable *today* — but the API must not rely on an external provider's config for a tenant boundary.

**Fix:** (1) Add `email_verified` to `JwtPayload` and reject tokens without `email_verified === true` in `jwt.strategy.validate()`. (2) Bind acceptance to the invitation `token` / `clerkInvitationId` (match on the Clerk invitation, not raw email). (3) Confirm the Clerk instance requires email verification.

---

### I4 — 🟡 MEDIUM (HIGH if misconfigured) — Dev-AI controller gated only by an env string ✅ VERIFIED

**Location:** `apps/api/src/controllers/dev/dev-ai.controller.ts:413-418`

```ts
private assertNotProduction(): void {
  const env = this.config.get<string>('NODE_ENV');
  if (env === 'production') throw new NotFoundException();
}
```

The controller is `@Public()` and reads **any org's** sessions/messages/traces/agent list with zero tenancy (`prisma.chatSession.findUnique({ where: { sessionId } })`, `prisma.agent.findMany` across all orgs). Its **only** protection is an exact-string `NODE_ENV === 'production'` compare.

**Exploit:** In any deployed environment where `NODE_ENV` is unset, `"prod"`, `"PRODUCTION"`, or otherwise not the exact string `"production"`, the entire controller is publicly reachable → unauthenticated cross-org conversation/trace read.

**Fix:** Exclude `DevAiController` from the module graph at build time in prod (conditional module import), or require `InternalSecretGuard`. Do not rely on a runtime env-string compare for a security boundary.

---

### I5 — 🟡 MEDIUM — `AgentDataFieldsController` missing `@UseGuards(RolesGuard)` ✅ VERIFIED

**Location:** `apps/api/src/controllers/agents/agent-data-fields.controller.ts:33-35`

The controller class has **no `@UseGuards(RolesGuard)`** (unlike every sibling controller — `RolesGuard` isn't even imported). Because `RolesGuard` is per-controller, the `@Roles(ADMIN, SUPER_ADMIN)` decorators on `list` / `replace` are **not enforced** — any authenticated CLIENT can reach the admin-only data-capture *definition* endpoints.

**Not cross-tenant:** the service still calls `assertAgentAccess`, which org-scopes CLIENT, so a CLIENT can only touch their *own* org's agents. Impact is a within-tenant role bypass — clients reading/editing PII-capture field definitions meant to be platform-staff-only.

**Fix:** Add `@UseGuards(RolesGuard)` to the controller class.

---

### I6 — 🟡 MEDIUM — `POST /invitations/reissue` is public

**Location:** `apps/api/src/controllers/invitations/invitations.controller.ts:111` → `services/invitations.service.ts:184-224`

Unauthenticated endpoint; gated only by a secret `reissueToken` and `reissueCount < 5`. Anyone holding a reissue token can re-send the invite email and reset expiry/status to `PENDING`. Matches the already-parked *"make reissue admin-only"* backlog item.

**Fix:** Require auth + `SUPER_ADMIN`; at minimum keep the count cap + rate-limit, and don't reset an already-cancelled invite to `PENDING`.

---

### I7 — 🔵 LOW — `validate/:token` discloses org + role pre-auth

**Location:** `services/invitations.service.ts:226-254`

Returns `{ email, organizationId, role }` for any valid unexpired token to an unauthenticated caller. By design (pre-signup validation) and the token is a secret, but it discloses the target org id + assigned role. **Fix:** acceptable given high token entropy; consider not echoing `organizationId`/`role` before auth.

### I8 — 🔵 LOW — `POST /invitations` body skips Zod validation

**Location:** `controllers/invitations/invitations.controller.ts:42`

`@Body() dto` isn't run through `ZodValidationPipe`, so `createInvitationSchema`'s refinements (org required for CLIENT / forbidden for ADMIN·SUPER_ADMIN) aren't enforced at runtime. `SUPER_ADMIN`-only → data-integrity robustness only. **Fix:** add `new ZodValidationPipe(createInvitationSchema)` to the `@Body()`.

---

## 4. Confirmed clean (verified strengths — SOC 2 control evidence)

These surfaces were traced and are **correctly tenant-scoped**. For SOC 2 they document as working CC6 (logical access) controls:

- **Conversations & analytics** — every endpoint scopes via `AnalyticsService.getAgentIds()` / `ConversationsService.buildAgentScopeFilter()`. A CLIENT passing a foreign `agentId`/`orgId` resolves to an empty set; all raw SQL filters `WHERE "agentId" = ANY(${agentIds})` off org-derived ids. Client-supplied `orgId` honored only for non-CLIENT.
- **Integrations & WhatsApp channels** — `assertAgentAccessible` / `AgentsService.findById` on every method. **Decrypted secrets are never returned** — responses carry only `credentialHint`; `accessTokenEnc` stripped from views. Decryption happens only server-side on the chat/test path.
- **RAG documents** — `assertAgentAccessible` + `findFirst({ id: documentId, agentId })`; a foreign `documentId` 404s. `rawText` excluded from list projections.
- **Internal cron endpoints** (`/internal/classifier`, `/internal/handover/sweep`, `/internal/data-extraction`) — fail-closed, constant-time `InternalSecretGuard` (rejects if secret unset, requires header, `timingSafeEqual`).
- **WhatsApp inbound webhook** — HMAC `X-Hub-Signature-256` over raw body, constant-time, fail-closed 503 if unconfigured; `phoneNumberId → channel` mapping is globally unique (no cross-tenant misrouting).
- **Handover HTTP API** — all actions go through `HandoverService.loadScopedSession`, which scopes CLIENT to own org and 404s otherwise; `takeover`/`resolve` further guard with `updateMany`.
- **Public chat HTTP** (`/public/chat/send|stream|request-human|warmup`) — `resolveOrCreateSession` enforces the session↔agent binding (`findFirst({ sessionId, agentId, status: ACTIVE })`), so a caller can't drive another agent's session; handover org derived from the resolved agent, never a client value.
- **Agents / knowledge / themes** — every `:agentId` sub-resource resolves through `assertAgentAccessible` / org-scoped `findFirst` before touching data.
- **Org / member / invitation mutations** — all writes are `SUPER_ADMIN`-only; `listMembers` org-scopes CLIENT; `updateProfile` never accepts `role`/`organizationId` (no self-escalation).

---

## 5. Fix-order checklist

**Status:** I1–I5 + I8 implemented on branch `fix/idor-hardening` (2026-07-12).
Full gate green: lint, check-types (5 pkgs), build (4/4), test:cov (1946 tests / 111 suites).
Pending: manual verification (see the per-fix test plan handed to the team) + review + merge.

**Launch blockers:**
- [x] **I1** — Authenticated the Socket.io handshake via a `server.use` middleware + new `WsAuthService`: verifies the Clerk token, derives org/role from the DB user, ignores client-supplied `orgId`/`platform`, rejects unowned rooms; `PLATFORM_ROOM` only for ADMIN/SUPER_ADMIN. Widget `sessionId` bearer path preserved. Web client sends a fresh token on each (re)connect. New unit suite `ws-auth.service.spec.ts` (15 cases incl. the original exploit).
- [x] **I2** — `deleteFile` now looks up the file scoped to the verified agent's `organizationId` (files are keyed by theme id, not agentId, so org-scope is the correct boundary), 404 on miss. Regression test added.

**This week:**
- [x] **I3** — Invitation acceptance now confirms via Clerk backend (`ClerkManagementService.isEmailVerified`) that the account owns AND verified the invited email before provisioning role/org; fail-closed. (Chosen over a JWT `email_verified` claim check, which would depend on template config and could break all logins.) Gate tests added.
- [x] **I4** — Replaced the fail-open `NODE_ENV === 'production'` check with a fail-closed `ENABLE_DEV_ROUTES=true` opt-in read via ConfigService (works from local `.env`, immune to NODE_ENV misconfig). Documented in `.env.example`.
- [x] **I5** — Added `@UseGuards(RolesGuard)` to `AgentDataFieldsController`.

**Backlog / decisions:**
- [ ] **I6** — NOT auth-gated: `POST /invitations/reissue` is a self-service (pre-login) flow; auth-gating breaks that UX and is an open product decision. Hardened instead: `reissueToken` now UUID-validated (Zod), reissue capped at 5, and `cancel()` deletes the row so a cancelled invite can't be resurrected. Revisit if product wants admin-only.
- [ ] **I7** — Left as-is (LOW): `validate/:token` echoes `organizationId`/`role` to a holder of the secret token; the signup UI renders from it, so changing the shape risks breaking that flow for no real gain.
- [x] **I8** — Added `ZodValidationPipe` to `POST /invitations` (create) and `POST /invitations/reissue`.
- [x] **I9** — `editor-config` is now `@Roles(...CLIENT)` too, and `getEditorConfig` is role-aware: it fetches/returns `webhookUrl` + `dataFields` only for ADMIN/SUPER_ADMIN, and returns `webhookUrl: null` / `dataFields: []` to a CLIENT. Fixes the "Agent not found" the client editor hit, without leaking the admin-only fields in the bundle (same principle as I5). Controller tests added (`agents.controller.spec.ts` getEditorConfig: full-for-admin, stripped-for-client, tenant 404). Found during live manual testing on 2026-07-20.

---

## 6. Note for the broader security/compliance effort

This audit covered **object-level authorization only** (one of the categories in the [2026-05-31 audit](./security-compliance-audit-2026-05-31.md)). Still open from that report and *not* re-examined here: GDPR right-to-erasure (F2), data-retention jobs (F3), visitor consent (F4), SSRF on webhook URLs (F5), CI SAST/dependency/secret scanning (F6), audit-log tamper-evidence (F7), PII scrubbing in logs/Sentry (F9), and data-export/portability (F8). Those remain the DPDP/GDPR/SOC 2 workstream.
