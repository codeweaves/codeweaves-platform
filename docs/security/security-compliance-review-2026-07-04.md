# Security & Compliance Review — CodeWeaves / Klivo Platform

**Date:** 2026-07-04
**Commit reviewed:** `6ffba2b` (HEAD of `develop` at review time)
**Scope:** `apps/api` (NestJS + Prisma/PostgreSQL), `apps/web` (Next.js dashboard), `apps/widget` (Preact embeddable chat), `packages/*`, CI, `docker-compose.yml`
**Frameworks assessed:** GDPR, India DPDP Act 2023, SOC 2 (Trust Services Criteria), OWASP/VAPT application surface, B2B enterprise-readiness
**Method:** Static review of source, schema, config and CI. Five focused passes (prior-findings re-verification, authorization/tenancy, GDPR + DPDP data protection, application security / injection / SSRF / supply chain, and a manual reviewer spot-check of every headline item). Every finding below was confirmed by reading the cited source directly.

> **Relationship to the prior audit.** This review supersedes and updates `docs/security/security-compliance-audit-2026-05-31.md`. That audit's findings were re-verified against current code: **0 of 15 numbered findings were fixed**, 1 LOW was partially fixed, and rate-limiting **regressed** (see §7). Three new PII-heavy features shipped since (WhatsApp channel, agent data capture, live human handover) and introduced new findings. Prior finding IDs are cross-referenced as `(was F#)`.

---

## 1. Executive summary

The platform keeps a **strong low-level security foundation**: Clerk JWT (RS256, JWKS, issuer verified), helmet with a strict production CSP + HSTS, a global `ValidationPipe`, Prisma parameterised queries throughout (no `$queryRawUnsafe`, the one `Prisma.raw` path is IANA-allowlisted), AES-256-GCM encryption of agent secrets and WhatsApp tokens, a fail-closed constant-time internal-secret guard, constant-time HMAC verification of WhatsApp webhooks, and a genuinely solid widget XSS sanitizer.

The problems are concentrated in four areas, and they are the areas that block regulated and enterprise customers:

1. **Multi-tenant isolation has two live cross-tenant data-exposure paths** — an unauthenticated realtime WebSocket and an unscoped knowledge-base API.
2. **Data-subject rights and consent are effectively absent** — the people whose data is processed (chat visitors) have no notice, no consent, and no access/erasure path; the data-capture feature is explicitly told *not to announce* that it is collecting personal data.
3. **Retention is unbounded** — no purge job exists anywhere; IPs, phone numbers, transcripts and extracted PII persist indefinitely in plaintext.
4. **Abuse controls regressed** — rate limiting is now opt-in and no route opts in, so the guard is a no-op platform-wide; the only surviving limiter is bypassable via a client header and fails open.

**Headline findings:**

| # | Severity | Finding | Framework |
|---|----------|---------|-----------|
| **C1** | 🔴 CRITICAL | Handover WebSocket gateway is unauthenticated — anonymous client can claim `platform:true`/any `orgId` and receive every tenant's conversation `sessionId`s, then read those chats via the public poll endpoint | Tenant isolation / GDPR Art.32 / SOC2 CC6 |
| **C2** | 🔴 CRITICAL | Cross-tenant IDOR on agent knowledge base — no auth scoping at all; any authenticated user reads/overwrites/deletes any org's KB (data theft + prompt poisoning) *(was F1)* | VAPT / SOC2 CC6 |
| **C3** | 🔴 CRITICAL | Covert PII collection: bot is instructed "do not announce that you are collecting information" and silently extracts name/email/phone to storage with no notice or consent | GDPR Art.5/6/13 / DPDP §5-6 |
| **H1** | 🟠 HIGH | No data-subject rights path for visitors (no access/erasure/export/rectification), no DPDP grievance officer | GDPR Art.15-20 / DPDP §11-14 |
| **H2** | 🟠 HIGH | SSRF via agent `webhookUrl` — no private/metadata-IP blocking; response reflected to caller *(was F5)* | VAPT |
| **H3** | 🟠 HIGH | Rate limiting regressed to no-op + surviving limiter bypassable (`x-device-id`) and fails open → unbounded LLM/voice cost DoS *(regression on F12)* | VAPT / Availability |
| **H4** | 🟠 HIGH | No privacy notice / consent anywhere in widget or WhatsApp, in any language *(was F4)* | GDPR Art.13 / DPDP §5 |
| **H5** | 🟠 HIGH | No retention enforcement — IP/phone/transcripts/extracted PII kept indefinitely; no purge job *(was F3)* | GDPR Art.5(1)(e) / DPDP §8(7) |
| **H6** | 🟠 HIGH | No right-to-erasure / hard delete; deletes are soft-delete only *(was F2)* | GDPR Art.17 / DPDP §12 |
| **H7** | 🟠 HIGH | Children's data: no age gate, no policy; embeddable widget + extraction = prohibited tracking of minors | DPDP §9 |
| **H8** | 🟠 HIGH | No SAST / dependency (CVE) / secret scanning in CI *(was F6)* | SOC2 CC7/CC9 |
| **H9** | 🟠 HIGH | Audit log is mutable and `AuditLog:Update`/`Delete` are granted to admins — not tamper-evident *(was F7)* | SOC2 CC6/PI1 |
| **H10** | 🟠 HIGH | No sub-processor register / DPA / cross-border transfer basis; Indian users' data round-trips AU + US | GDPR Art.28/44-46 / DPDP §16 |
| **M1** | 🟡 MED | `AgentDataFieldsController` missing `@UseGuards(RolesGuard)` → `@Roles` is a no-op (in-tenant privilege escalation) | VAPT / SOC2 CC6 |
| **M2** | 🟡 MED | `FilesService.deleteFile` IDOR — file not verified to belong to the scoped agent | VAPT |
| **M3** | 🟡 MED | SVG upload allowed → stored XSS via Supabase public URL | VAPT |
| **M4** | 🟡 MED | Client-supplied `recentHistory` fed verbatim into LLM context → self-session jailbreak | LLM security |
| **M5** | 🟡 MED | No application-layer encryption for chat content / extracted PII; no breach-notification runbook *(was F13)* | GDPR Art.32 / DPDP §8(6) |
| **M6** | 🟡 MED | Sentry scrubber misses `email`/`name`/`phone`/`visitorId` + `cookie`/`x-api-key` headers; no Pino redaction *(was F9)* | GDPR Art.32 |
| **M7** | 🟡 MED | No boot-time config/env schema validation *(was F10)* | SOC2 CC |
| **M8** | 🟡 MED | Incomplete audit-event coverage (no login/logout/role-change ingestion) *(was F11)* | SOC2 CC6/CC7 |
| **M9** | 🟡 MED | Handover operators (incl. platform staff) read full visitor threads + raw IP/phone with no access logging | GDPR Art.32 / DPDP §8 |
| **M10** | 🟡 MED | Over-broad wildcard domain validation accepts `*.com` *(was F14)* | VAPT |
| **M11** | 🟡 MED | WebSocket `typing`/`watch`/`unwatch` unthrottled; unlimited room joins (DoS) | Availability |
| **M12** | 🟡 MED | No documented backup / DR / RPO-RTO / RLS / DB least-privilege *(was F15)* | SOC2 A1 |
| — | 🔵 LOW | Health endpoint leaks version/uptime; JWT audience optional; poll + invitation endpoints unthrottled; WhatsApp `verify_token` non-constant-time; widget CORS empty-list allow-all; cookie `SameSite=Lax`; n8n sync response unvalidated; CI actions pinned to mutable tags | Mixed |

---

## 2. What's already done well (verified controls — document these as SOC 2 evidence)

- **Clerk JWT validation** — RS256, JWKS with rate-limited fetch, issuer verified, expiry enforced. Tenant identity is **server-derived**: the strategy takes only `sub`+`email` from the token, and `UserSyncGuard` loads role/org from the DB by Clerk id — org is never trusted from a client header/body. (`strategies/jwt.strategy.ts`, `guards/user-sync.guard.ts`)
- **Secret encryption at rest** — `CryptoService` AES-256-GCM, random 16-byte IV + auth tag, 32-byte key validated at boot. Used for `AgentSecret.webhookUrl` and `WhatsappChannel.accessTokenEnc`. (`common/crypto/crypto.service.ts`)
- **Internal cron auth** — `InternalSecretGuard` is fail-closed (rejects when `INTERNAL_API_SECRET` unset) and constant-time. (`guards/internal-secret.guard.ts`)
- **WhatsApp webhook** — verifies `X-Hub-Signature-256` HMAC over the raw body, constant-time, fail-closed if app-secret/verify-token missing; routes strictly by `phone_number_id → channel → agent`. (`modules/whatsapp/whatsapp-webhook.controller.ts`, `main.ts` `rawBody:true`)
- **SQL injection** — no `$queryRawUnsafe`/`$executeRawUnsafe`; all `$queryRaw` are parameterised tagged templates; the one `Prisma.raw` timezone path is IANA-allowlisted. (`services/analytics.service.ts`, `utils/date-range.ts`)
- **Widget XSS** — DOMParser + tag allowlist sanitizer, strips scripts/handlers, validates href protocols, forces `rel="noopener noreferrer"`; user messages rendered as plain text; dashboard uses no `dangerouslySetInnerHTML`. (`apps/widget/src/utils/sanitizer.ts`, `markdown.ts`)
- **LLM prompt hygiene** — visitor text stays in the `user` role and is never concatenated into the system prompt; the prompt template only fills an allowlisted variable set; extracted fields are type-validated (strict structured output) before persistence. (`modules/ai/context-assembly.service.ts`, `prompt-template.service.ts`, `common/ai/ai-classifier.service.ts`)
- **Security headers** — helmet with prod CSP `default-src 'none'`, HSTS 1yr + includeSubDomains, `frameguard: deny`, `hidePoweredBy`. (`config/security-headers.config.ts`)
- **Input limits** — chat message ≤4000 chars, history ≤100 items; file upload 2 MB with MIME/size/filename checks; voice upload 10 MB.
- **Dev test page** — every `dev/ai/*` handler 404s in production; renders via `textContent` (no HTML injection). (`controllers/dev/*`)
- **Handover dashboard API** (as opposed to the WebSocket) — properly `RolesGuard`-protected and org-scoped via `loadScopedSession`/`agentScope`. (`services/handover.service.ts`)
- **No hardcoded secrets** in source or `docker-compose.yml`; `.env.example` holds placeholders only; no git/tarball deps in `bun.lock`.
- **Phone masking in logs**, minimal HTTP logging (no bodies/queries), Sentry session-replay disabled, 7-day AI-trace file-log rotation.

---

## 3. Critical findings

### C1 — 🔴 CRITICAL — Handover WebSocket gateway is unauthenticated (cross-tenant conversation disclosure)
**Where:** `apps/api/src/gateways/handover.gateway.ts:41-74` (connection), `:110-127` (`watch`), `:133-146` (emits); amplified by `apps/api/src/controllers/public/public-chat.controller.ts:153-166` + `apps/api/src/services/chat.service.ts:403-419` (`pollPublicSession`).

**What:** The gateway is declared `@WebSocketGateway({ cors: { origin: true, credentials: false } })` and `handleConnection` joins Socket.io rooms **purely from client-supplied handshake values**, with no token verification:
```ts
const orgId = pickStr(h.auth?.orgId) ?? pickStr(h.query?.orgId);
const platform = h.auth?.platform === true || h.query?.platform === 'true';
if (orgId)   client.join(orgRoom(orgId));
if (platform) client.join(PLATFORM_ROOM);   // every org's events fan out here
```
There is no Socket.io auth middleware anywhere (no `server.use(...)`), and CORS allows any origin. `emitHandover`/`emitMessage` broadcast `{ sessionId, handoverState }` to the org room **and** `PLATFORM_ROOM` on every handover event platform-wide. The class doc concedes org↔session validation is deferred to "Phase 3" — but the gateway is merged and `RealtimeService` emits into these rooms in production.

**Exploit (zero prior knowledge):** An attacker opens a socket with `auth: { platform: true }`, joins `PLATFORM_ROOM`, and receives a live feed of `{ sessionId }` for **every handover conversation across all tenants**. Each `sessionId` is the bearer for the unauthenticated `GET /public/chat/:sessionId/poll`, which returns the **full message content** of that conversation (visitor PII, human-agent replies). Supplying a victim's `orgId` instead joins that org's inbox room directly; `watch` lets any org/platform-claiming client join arbitrary `session:` rooms.

**Fix:** Register a Socket.io connection middleware that verifies a Clerk JWT for dashboard/platform sockets and derives `orgId`/`platform` **only** from verified claims. For widget sockets, verify the `sessionId` exists and join only that one `session:<id>` room. Do not honor client-sent `orgId`/`platform`. Authorize `watch` against the socket's real org. Consider removing the `PLATFORM_ROOM` fan-out unless the socket proved platform-admin identity.

### C2 — 🔴 CRITICAL — Cross-tenant IDOR on agent knowledge base *(was F1, still open)*
**Where:** `apps/api/src/controllers/agents/agent-knowledge.controller.ts` (entire file), `apps/api/src/services/agent-knowledge.service.ts:66-69, 205-222`.

**What:** The controller comment claims *"the global JwtAuthGuard + RolesGuard from AppModule handle auth"* — but **`RolesGuard` is not a global guard**. `app.module.ts:73-85` registers only `JwtAuthGuard`, `UserSyncGuard`, and `RateLimitGuard` as `APP_GUARD`. The controller has **no `@UseGuards(RolesGuard)`, no `@Roles`, and takes no `@CurrentUser()`** — it passes only the URL `agentId` to the service. The service is entirely unscoped: `get()`/`remove()` query by `{ agentId }` directly, and `assertAgentExists()` (`:214-222`) filters only `{ id, deletedAt: null }` with **no `organizationId`**.

**Exploit:** Any authenticated user of any tenant (including a `CLIENT`) can `GET`/`PUT`/`POST extract`/`DELETE /agents/:agentId/knowledge` for **any** agent by UUID. This is cross-tenant knowledge-base **read** (data theft), **overwrite** (prompt poisoning — the KB is prepended verbatim to the target agent's system prompt via `KNOWLEDGE_DIVIDER`), and **delete**.

**Why it still exists:** The org-scoped pattern is already used in newer sibling services — `agent-data-fields.service.ts:191-208`, `agent-themes.service.ts`, `files.service.ts:147`. C2 is simply the one file that was never backported. **Note:** fixing C2's controller guard also fixes M1 by the same mechanism.

**Fix:** Add `@UseGuards(RolesGuard)` + appropriate `@Roles`, thread `@CurrentUser()` into the service, and scope every query by `organizationId` for CLIENT (SUPER_ADMIN/ADMIN platform-staff bypass explicit), mirroring `AgentDataFieldsService.assertAgentAccess`. Add a regression test: org-A user + org-B agentId → 404.

### C3 — 🔴 CRITICAL — Covert PII collection without notice or consent
**Where:** `apps/api/src/modules/ai/direct-chat.service.ts:693-701` (specifically `:696`), extraction in `apps/api/src/services/data-extraction.service.ts:196-266`, storage `CollectedData` (`prisma/schema.prisma:338-356`).

**What:** When an agent has data-capture fields configured, the system prompt is injected with:
> *"While helping the user, naturally note the following details if they come up. **Do not announce that you are collecting information**, and NEVER delay or withhold an answer in order to ask for it…"*

A background extractor then sends the **full transcript** to an LLM and upserts structured personal data (the `DataFieldType` enum explicitly includes `EMAIL` and `PHONE`) into `CollectedData`. The visitor is never told, sees no notice, and gives no consent for this secondary purpose (lead capture, distinct from answering their question).

The instruction's *intent* is a UX one — don't be robotic, prioritise answering. But combined with **zero** privacy notice anywhere (H4) and silent server-side extraction, the effect is covert collection of personal data. A regulator would treat a deliberate "do not announce" instruction as an aggravating factor (GDPR Art.83(2)(b)).

**Regulation:** GDPR Art.5(1)(a) transparency, Art.6 (no lawful basis established), Art.13/14 (no notice at/after collection); DPDP §5 (notice per purpose) + §6 (free, specific, informed consent per purpose).

**Fix:** (1) Remove or invert the "do not announce" instruction. (2) Show a purpose notice in the widget/WhatsApp when data capture is enabled ("This chat may collect your contact details for follow-up — <privacy policy>"). (3) Gate extraction on recorded consent per session. (4) Provide the in-product mechanism for tenants (controllers) to meet their notice duty, and cover the split of responsibilities in the customer DPA.

---

## 4. High-severity findings

### H1 — 🟠 HIGH — No data-subject rights path for visitors *(was F8, expanded)*
**Where:** exhaustive search of API `@Delete`/export routes — no endpoint deletes or exports a `ChatSession`, `ChatMessage`, `CollectedData`, `ChatTrace`, or `visitorId` for anyone; `POST /analytics/export-log` only logs an export *event*. Visitors have no authentication surface, so no way to exercise any right.
**Regulation:** GDPR Art.15 (access), 16 (rectification — `CollectedData` is LLM-derived and may be wrong), 17 (erasure), 20 (portability); DPDP §11-13, incl. mandatory §13 grievance redressal (no grievance officer contact exists anywhere).
**Fix:** (1) Tenant-facing "delete conversation / delete captured data" + JSON export endpoints. (2) A `visitorId`-keyed erasure job (hard-delete messages + `CollectedData` + traces, tombstone the session — `CollectedData` already cascades on session delete, so session hard-delete is a clean erasure primitive). (3) Publish a grievance officer contact and complaint intake with a tracked SLA (≤30 days) before Indian rollout.

### H2 — 🟠 HIGH — SSRF via agent `webhookUrl` *(was F5, still open)*
**Where:** `services/agents.service.ts:489-498` (`setWebhookUrl` — only `startsWith('https://')`, prod-only); sinks `services/chat.service.ts:763` (`callN8nWebhook`), `agents.service.ts:578` (`testWebhook`), `services/n8n-streaming.service.ts:43`.
**What:** No block of loopback/private/link-local/metadata IPs (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254`, `::1`), no DNS-rebind protection. `testWebhook` returns the status code and `callN8nWebhook` parses and returns the response body — so it's a blind + reflected SSRF into the internal network. In non-prod even `http://` is accepted.
**Fix:** Resolve the host and reject private/reserved/link-local IPs post-DNS and re-check on connect (rebinding-safe); enforce `https` in all environments; allowlist ports; do not reflect the response body; optional enterprise allow-list.

### H3 — 🟠 HIGH — Rate limiting is a no-op + the surviving limiter is bypassable and fails open *(regression on F12)*
**Where:** `guards/rate-limit.guard.ts:26-38` (opt-in — undecorated routes return immediately); **zero** `@RateLimit()` decorators exist in any controller; `common/redis/rate-limiter.service.ts:107` (`failOpen` → `allowed:true` on any Redis error); `services/message-rate-limit.service.ts:72-89` (`getDeviceIdentifier` prefers the client-controlled `x-device-id` header as the bucket key).
**What:** The global `RateLimitGuard` is registered but limits nothing. The only surviving control — the per-device message limiter on public chat/voice — keys on a spoofable header (rotate `x-device-id` → unlimited) and fails open (Redis down or over quota → no limiting at all). The old 100/min-authed / 30/min-public baseline that the May audit relied on is gone platform-wide.
**Exploit:** Script the public chat/voice endpoint with a rotating `x-device-id` → unbounded LLM/STT/TTS spend and backend load; the invitation/poll endpoints have no brake at all.
**Fix:** Key the limiter on server-derived identity (authenticated user, or client IP after `trust proxy`) with `x-device-id` only as a sub-key; add `@RateLimit()` to public/abuse-prone routes as the design intends; consider fail-closed (or a small in-memory fallback) for public routes.

### H4 — 🟠 HIGH — No privacy notice / consent in widget or WhatsApp *(was F4, still open)*
**Where:** no `consent|privacy|notice|policy` product code in `apps/widget/src`; `chat.service.ts:318-326` stores `req.ip` into `ChatSession.visitorId` on first message; WhatsApp stores the raw phone number as `visitorId` (`whatsapp-outbound.service.ts:32`). DPDP §5(3) additionally requires notice available in English or any Eighth-Schedule language — the platform already classifies conversations in hi/mr/hinglish, so the multilingual capability exists but is unused for notice.
**Fix:** Configurable pre-chat notice + privacy-policy link in the widget frame; a WhatsApp first-contact notice message; minimise IP (truncate IPv4 to /24, IPv6 to /64, or salted hash) since its only functional uses are rate-limiting and a distinct-visitor count.

### H5 — 🟠 HIGH — No retention enforcement *(was F3, still open)*
**Where:** no purge/cron deletes any PII table (the only `deleteMany` is a config wipe of `agentDataField`). Session "expiry" only flips a status flag. `ChatTrace` duplicates every user message + response forever. Only positive: 7-day rotation of Pino file logs.
**Regulation:** GDPR Art.5(1)(e); DPDP §8(7) requires erasure once the purpose is served.
**Fix:** Configurable retention windows + scheduled purge, reusing the existing Postgres-poll runner + `/internal/*` secret-guarded cron pattern. Priority order: `ChatTrace` (debug data, 30d) → `visitorId` IPs (null after 90d) → messages / `CollectedData` (tenant-configurable). Publish periods in the privacy policy.

### H6 — 🟠 HIGH — No right-to-erasure / hard delete *(was F2, still open)*
**Where:** `organizations.service.ts` and `agents.service.ts:361` set `deletedAt` only; PII rows persist indefinitely.
**Fix:** Erasure workflow (queue → scheduled hard-delete/anonymisation: null `visitorId`, scrub `User.email/name` to a tombstone, cascade-delete messages/traces/collected data), retaining a non-PII deletion record for audit. Document a ≤30-day SLA. Builds on the same primitive as H1.

### H7 — 🟠 HIGH — Children's data: no age gate or policy (DPDP §9)
**Where:** no age/minor/parental-consent handling anywhere in widget or API. DPDP §9 requires verifiable parental consent for children and **prohibits tracking / behavioural monitoring of children**.
**What:** The widget is embeddable on any site, including child-directed ones; conversation classification + data extraction on a minor would constitute prohibited processing. No age signal, no policy, no tenant control.
**Fix:** Provide a tenant-configurable age-gate / "no minors" attestation, document the prohibition in the DPA, and allow tenants to disable extraction/classification for child-directed deployments.

### H8 — 🟠 HIGH — No SAST / SCA / secret scanning in CI *(was F6, still open)*
**Where:** `.github/workflows/ci.yml` runs lint/typecheck/test/build only; no `.github/dependabot.yml`.
**Fix:** Add `bun audit` (fail on high), a SAST step (Semgrep/CodeQL), GitHub secret scanning + Dependabot, and a pre-commit secret scan (gitleaks). Pin third-party actions to commit SHAs (they currently float on major tags). Table-stakes SOC 2 evidence.

### H9 — 🟠 HIGH — Audit log not tamper-evident; delete/update permissions granted *(was F7, still open)*
**Where:** `prisma/schema.prisma:618-635` (`AuditLog`, no immutability mechanism); `common/rbac/permissions.ts:92-93` grants `AuditLog:Update` and `AuditLog:Delete` to `ADMIN_AND_ABOVE`. No migration contains a `REVOKE` or trigger.
**Fix:** `REVOKE UPDATE, DELETE ON audit_logs` from the app role; add BEFORE UPDATE/DELETE triggers that raise; remove `AuditLog:Update/Delete` from the permission matrix; (phase 2) hash-chain rows for tamper evidence.

### H10 — 🟠 HIGH — No sub-processor governance / cross-border transfer basis
**Where:** every external recipient of personal data is listed in §8. No DPA references, no SCC/adequacy documentation, no zero-retention flags configured for LLM/voice providers. Indian users' data round-trips through Supabase AU (Sydney) and US LLM/voice/error providers.
**Regulation:** GDPR Art.28, Art.44-46; DPDP §16.
**Fix:** Maintain a sub-processor register (§8 is the starting point); enable OpenAI/OpenRouter zero-data-retention; prefer Sarvam (India-hosted) for Indian tenants' voice; offer a Supabase `ap-south-1` (Mumbai) deployment for India; publish a sub-processor page and provide a customer DPA + SCCs.

---

## 5. Medium-severity findings

- **M1 — `AgentDataFieldsController` missing `@UseGuards(RolesGuard)`.** `controllers/agents/agent-data-fields.controller.ts:33-71` — the only new controller with `@Roles(...)` but no `@UseGuards(RolesGuard)` (every sibling controller has it). Because `RolesGuard` is not global, the `@Roles(ADMIN, SUPER_ADMIN)` on `list`/`replace` is unenforced, so a `CLIENT` can view/rewrite data-capture field definitions. Impact is in-tenant (service still org-scopes CLIENT via `assertAgentAccess`) — a role escalation, not cross-tenant. **Fix:** add `@UseGuards(RolesGuard)` to the class.
- **M2 — `FilesService.deleteFile` IDOR.** `services/files.service.ts:111-129` — verifies agent access via `ensureAgentAccess(agentId)`, then looks up the file by `id` alone and deletes it, never checking `file.entityId === agentId`. A CLIENT owning agentA can delete any file in the system by UUID (storage object + DB row). **Fix:** `findFirst({ where: { id: fileId, entityId: agentId } })`; 404 on miss.
- **M3 — SVG upload → stored XSS.** `services/files.service.ts:14` includes `image/svg+xml` in `ALLOWED_MIME_TYPES`; files get a Supabase `publicUrl`. An SVG can carry `<script>` that executes in the storage origin when opened directly. MIME comes from the multipart part, not sniffed. **Fix:** drop SVG (or sanitize server-side + force `Content-Disposition: attachment`); add magic-byte sniffing to a raster allowlist.
- **M4 — Client-supplied `recentHistory` fed verbatim to the LLM.** `modules/ai/context-assembly.service.ts:98-103` uses caller history and skips the DB; `packages/validation/src/chat.ts` allows 100 items × 10 000 chars with a caller-set `role`. A visitor can fabricate prior `assistant`/`[System]:` turns to jailbreak their own session ("you already approved a full refund"). Confined to the attacker's own session, but defeats history-based guardrails. **Fix:** reconstruct history from persisted rows for anything security-relevant, or sign/verify it.
- **M5 — No app-layer encryption for chat content / extracted PII; no breach runbook** *(was F13).* `ChatMessage.content`, `ChatTrace.userMessage/response`, `CollectedData.data`, `AuditLog.data` are plaintext (only `AgentSecret`/`WhatsappChannel` tokens are encrypted). DPDP §8(6) mandates breach notification to the Data Protection Board *and* each affected principal (penalties to ₹250 crore). **Fix:** column-level encryption for `CollectedData.data` at minimum (low volume, high sensitivity, primitive already exists); write and test a breach-notification runbook.
- **M6 — Sentry scrubber misses PII** *(was F9).* `common/sentry/sentry.scrubber.ts:3-6` — `SENSITIVE_KEYS` still `password|secret|token|apikey|api_key|credential|authorization`; misses `email`/`name`/`phone`/`visitorId`/`content`; `SCRUBBED_HEADERS = ['authorization']` only (misses `cookie`/`x-api-key`/`x-device-id`); `event.user.ip_address` untouched; no Pino `redact`. **Fix:** extend the regex + header list, drop `event.user` to `{id}`, set `sendDefaultPii:false`, add a Pino redaction serializer.
- **M7 — No boot-time config validation** *(was F10).* `modules/app.module.ts:42-45` has no `validationSchema`; only piecemeal constructor checks (`CLERK_ISSUER`, `AGENT_SECRET_KEY`). **Fix:** add a Zod/Joi `validationSchema` so missing `DATABASE_URL`/`CLERK_*`/`AGENT_SECRET_KEY`/(prod)`INTERNAL_API_SECRET`/`WHATSAPP_APP_SECRET` fail fast at boot.
- **M8 — Incomplete audit coverage** *(was F11).* Present: first-login, member add/remove, invitation lifecycle, secret/webhook updates, org CRUD. Missing: login success/failure, logout, role/permission change. Login/logout are now Clerk-hosted but no Clerk webhook is ingested, so the app-side trail has a gap. **Fix:** ingest Clerk webhooks (or log at the session guard) and add a role-change audit event.
- **M9 — Handover operator reads not access-logged.** `services/handover.service.ts:328-354` (`getThread`) returns full messages + raw `visitorId` (IP/phone) and writes no `AuditLog`; `listInbox` exposes `visitorId` to any org user. Platform staff (ADMIN/SUPER_ADMIN) can read **any** tenant's threads and `CollectedData` (by design — see note below) with no logged justification. **Fix:** write an `AuditLog` row on `getThread`/`takeover`/collected-data views; truncate/hide `visitorId` in the Inbox UI; require break-glass logging for platform-staff cross-org reads.
- **M10 — Over-broad wildcard domains** *(was F14).* `utils/domain.ts:22-23` — `WILDCARD_RE`'s label group is zero-or-more, so `*.com` validates. Combined with the "empty list = allow all" CORS default (LOW), this widens the widget origin surface. **Fix:** require ≥2 labels after `*.`.
- **M11 — WebSocket flooding.** `gateways/handover.gateway.ts:84-127` — `typing`/`watch`/`unwatch` unthrottled; `watch` allows unlimited room joins. **Fix:** per-socket message rate limit + cap on joined rooms.
- **M12 — No backup/DR/RLS/least-privilege docs** *(was F15).* No DR document (RPO/RTO/PITR/restore test); RLS appears only as a future plan; DB grants/`sslmode` undocumented. **Fix:** document Supabase PITR window, RPO/RTO, monthly restore test, app-role least-privilege grants, enforce `sslmode=require`, and evaluate RLS as defense-in-depth for tenant tables.

---

## 6. Low-severity findings

- **Health endpoint** returns `version` + `uptime` publicly (`modules/health/health.controller.ts:20-25`) → move detail behind auth.
- **JWT audience optional** (`strategies/jwt.strategy.ts:17,28`) — if `CLERK_JWT_AUDIENCE` unset, only issuer + signature are checked. On a shared Clerk issuer, a token for a different audience would be accepted. Set and enforce it in prod.
- **Public poll endpoint unthrottled** (`public-chat.controller.ts:153`) — low risk alone (UUID sessionId) but it's the read primitive for C1. Add a per-IP limit.
- **Public invitation endpoints unthrottled** (`invitations.controller.ts:49,111`) — tokens are 122-bit UUIDs so enumeration is infeasible; still add a limiter + abuse logging.
- **WhatsApp `hub.verify_token` uses `===`** (`whatsapp-webhook.controller.ts:71`) — minor timing leak; use `timingSafeEqual` (the payload HMAC already does).
- **Widget CORS empty-list allow-all** (`middleware/widget-cors.middleware.ts:205`) — documented default; note CORS is browser-only here (rejected origins still `next()`), so `allowedDomains` is not a server-side authz control.
- **Cookie `SameSite=Lax`** on widget device id (`apps/widget/src/utils/device-id.ts`) → `Strict` unless cross-site embedding needs Lax.
- **n8n sync response** (`chat.service.ts:785-811`) `JSON.parse` with no schema/size cap (10s timeout only). The streaming path now has a 1 MB cap + per-chunk validation — bring the sync path to parity.

---

## 7. Prior-audit remediation status (2026-05-31 → 2026-07-04)

| Prior | Status now | This report |
|-------|-----------|-------------|
| F1 IDOR (agent knowledge) | 🔴 STILL OPEN | C2 |
| F2 no erasure | 🟠 STILL OPEN | H6 |
| F3 no retention | 🟠 STILL OPEN | H5 |
| F4 no consent (IP/phone) | 🟠 STILL OPEN | H4 / C3 |
| F5 SSRF webhookUrl | 🟠 STILL OPEN | H2 |
| F6 no CI scanning | 🟠 STILL OPEN | H8 |
| F7 audit log mutable | 🟠 STILL OPEN | H9 |
| F8 no export/portability | 🟠 STILL OPEN | H1 |
| F9 scrubber misses PII | 🟡 STILL OPEN | M6 |
| F10 no config validation | 🟡 STILL OPEN | M7 |
| F11 audit coverage | 🟡 STILL OPEN | M8 |
| F12 invite brute-force | 🟡 STILL OPEN + **regressed** | H3 / LOW |
| F13 plaintext at rest | 🟡 STILL OPEN | M5 |
| F14 wildcard `*.com` | 🟡 STILL OPEN | M10 |
| F15 no DR docs | 🟡 STILL OPEN | M12 |
| LOW: health / cookie / n8n / DB RLS | 3 open, n8n partial | §6 |
| **Rate-limit baseline** | 🔴 **REGRESSED** — opt-in guard now no-op platform-wide, fail-open | H3 |

**Net:** 0 of 15 fixed; 1 LOW partially fixed; rate limiting regressed. The org-scoping pattern used in newer services (`agent-data-fields`, `themes`, `files`) confirms F1/C2 was a known pattern that was simply not backported.

---

## 8. Sub-processor register (personal data recipients — for GDPR DPA / DPDP §16)

| Recipient | Data sent | Evidence | Region |
|---|---|---|---|
| **Supabase Postgres** | entire PII inventory | `.env.example:10-11` | AU (`aws-1-ap-southeast-2`, Sydney) |
| **Supabase Storage** | uploaded files | `supabase-storage.service.ts` | AU |
| **OpenAI** (default `gpt-4.1`) | full transcripts + KB + collection instruction; warmup pre-sends the system prompt | `ai-sdk.service.ts:223`; `public-chat.controller.ts:101-120` | US |
| **OpenRouter / Gemini / Groq / Cerebras / Sarvam LLM** | transcripts (when selected); extraction transcripts | `ai-sdk.service.ts:230-247` | US / IN |
| **ElevenLabs** | raw visitor voice audio + reply text | `elevenlabs.provider.ts` | US |
| **Sarvam AI** | voice audio + text | `sarvam.provider.ts` | IN |
| **Deepgram** | voice audio | `deepgram.provider.ts` | US |
| **Meta / WhatsApp Cloud API** | message content, phone numbers, voice media | `whatsapp.constants.ts:16`; `whatsapp-send.service.ts` | US/global |
| **Clerk** | dashboard user emails, invitations | `clerk-management.service.ts` | US |
| **Sentry** | error events incl. request bodies (partially scrubbed) | `main.ts:13-26` | US/EU |
| **Resend** | invitee emails | `email.service.ts` | US |
| **Tenant n8n webhooks (arbitrary URLs)** | full chat messages | `n8n-streaming.service.ts:43` | tenant-controlled |

---

## 9. Compliance readiness scorecard

| Area | Status | Blocking gaps |
|------|--------|---------------|
| **GDPR** | 🔴 Not ready | Covert collection (C3), no rights path (H1), no consent/notice (H4), no retention/erasure (H5/H6), sub-processors/transfers (H10), plaintext PII (M5), scrubbing (M6). Needs: privacy policy, RoPA, sub-processor page, customer DPA + SCCs. |
| **DPDP (India)** | 🔴 Not ready | Notice + consent per purpose (C3/H4), grievance officer §13 (H1), children's data §9 (H7), erasure on purpose-served §8(7) (H5), breach-notification readiness §8(6) (M5), cross-border enumeration §16 (H10). Multilingual notice capability exists but unused. |
| **SOC 2** | 🟠 Foundations only | Tenant isolation (C1/C2), audit immutability + coverage (H9/M8), CI scanning (H8), config validation (M7), DR/backup docs (M12). Most remaining gaps are process/docs, not code. |
| **VAPT (app surface)** | 🔴 Two criticals | C1 WebSocket + C2 IDOR first, then H2 SSRF, H3 rate-limit, M1-M4. Commission an external pen test after remediation. |
| **B2B enterprise-ready** | 🟠 Not yet | Tenant-isolation hardening (C1/C2 + sweep), data-residency option, audit-log export, status/SLA, security + sub-processor page. Clerk already gives you enterprise SSO to expose. |

---

## 10. Prioritised remediation roadmap

**P0 — this week (live data-exposure, code):**
1. **C1** — authenticate the handover WebSocket (verify Clerk JWT; derive org/platform from claims; drop client-trusted `orgId`/`platform`; scope `watch`).
2. **C2** — add `RolesGuard` + `@CurrentUser` + org scoping to agent-knowledge (fixes **M1** too); regression test.
3. **H2** — SSRF guard on `webhookUrl` (save-time + request-time, rebinding-safe); stop reflecting the body.
4. **H3** — restore real rate limiting (server-derived key, decorate public routes, reconsider fail-open).

**P1 — 2-4 weeks (GDPR/DPDP rights + SOC 2 integrity):**
5. **C3 + H4** — remove "do not announce"; add widget/WhatsApp privacy notice + consent gate (multilingual).
6. **H1 + H6** — visitor/tenant erasure + export endpoints + grievance officer contact.
7. **H5** — retention purge jobs (start with `ChatTrace` + IP nulling — cheapest wins).
8. **H9 + M8** — audit-log immutability (revoke + triggers, drop delete perm) + event coverage.
9. **H8** — CI dependency/SAST/secret scanning + Dependabot + SHA-pinned actions.
10. **M6 + M7** — PII-aware Sentry + Pino redaction; boot-time config validation.

**P2 — 1-2 months (regulated/enterprise polish):**
11. **M5** — encrypt `CollectedData.data`; write + test a breach-notification runbook (DPB + affected principals).
12. **H10** — sub-processor register + DPA/SCCs; enable provider zero-retention; Mumbai region option for India.
13. **H7** — children's-data age gate/attestation + policy.
14. **M2/M3/M4/M9/M10/M11** — files IDOR, SVG upload, client history trust, operator-read logging, wildcard fix, WS throttling.
15. **M12** + LOW items — DR/backup/RLS docs, health endpoint, JWT audience, cookie flags, n8n sync validation.
16. Policy/doc set (privacy policy, RoPA, access/change/incident/vendor policies); commission external VAPT; pursue SOC 2 Type I → II.

---

## 11. Note on the role model (not a finding — important context)

`ADMIN` and `SUPER_ADMIN` are **platform staff** (CodeWeaves personnel); `CLIENT` is the tenant-scoped customer role. This is consistent across `handover.service.ts`, `conversations.service.ts`, and `agent-data-fields.service.ts` (all scope only CLIENT by org; ADMIN/SUPER_ADMIN see all tenants, optionally filtered by `orgId`). So an ADMIN reading any tenant's conversations is **by design**, not a cross-tenant IDOR — but it is a real GDPR/DPDP concern (processor personnel accessing all customer PII), which is why M9 (access logging on those reads) matters. C1 and C2 are different: they expose data to parties who are *not* platform staff (anonymous clients, and any CLIENT of any tenant), which is a genuine breach of isolation.

---

_Generated from a five-pass static review on 2026-07-04, every headline item verified against source. This document is a working remediation tracker, not a formal attestation. Confirm each item at the cited location before and after remediation, and add regression tests for C1, C2, H2, and M1/M2._
