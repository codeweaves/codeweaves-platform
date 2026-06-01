# Security & Compliance Audit — Klivo / CodeWeaves Platform

**Date:** 2026-05-31
**Scope:** `apps/api` (NestJS), `apps/web` (Next.js), `apps/widget`, `packages/*`, Prisma/PostgreSQL schema
**Frameworks assessed:** GDPR, SOC 2 (Trust Services Criteria), VAPT (application pen-test surface), general B2B enterprise-readiness
**Method:** Static review of source, schema, config, and CI. Five parallel review passes (authz/tenancy, GDPR/PII, injection/VAPT, secrets/CORS/rate-limit, SOC2 logging/supply-chain). Highest-severity findings independently verified against source.

> **Note on confidence.** Findings marked ✅ **VERIFIED** were confirmed by reading the cited source directly. Others are review-pass findings at the cited location and should be confirmed before acting. Two agent-reported "criticals" were **disproven** during verification and corrected below — see _Corrected / non-issues_.

---

## 1. Executive summary

The platform has a **strong security foundation**: Auth0 JWT (RS256, issuer/audience verified), helmet with prod CSP/HSTS, global `ValidationPipe` (whitelist + forbidNonWhitelisted), Prisma (parameterised queries), AES-256-GCM encryption of agent secrets, Redis-backed rate limiting, per-agent CORS allow-listing, a custom widget HTML sanitizer, and an `AuditLog` table with correlation IDs.

The gaps that block B2B / regulated customers are **not** in the crypto or the framework wiring — they are in **multi-tenant authorization completeness**, **data-subject rights (GDPR)**, **audit-trail integrity & coverage (SOC 2)**, and **supply-chain scanning (SOC 2 CC)**.

**Headline items:**

| # | Severity | Finding | Framework |
|---|----------|---------|-----------|
| F1 | 🔴 CRITICAL | Cross-tenant IDOR on agent knowledge endpoints (no org scoping) ✅ VERIFIED | VAPT / SOC2 CC6 |
| F2 | 🟠 HIGH | No right-to-erasure / hard-delete of PII (soft-delete only) | GDPR Art.17 |
| F3 | 🟠 HIGH | No data-retention jobs — chat/IP/trace data kept indefinitely | GDPR Art.5(1)(e) |
| F4 | 🟠 HIGH | No visitor consent before storing raw IP / phone in `visitorId` | GDPR Art.6/7 |
| F5 | 🟠 HIGH | SSRF: agent `webhookUrl` not validated against internal/metadata IPs | VAPT |
| F6 | 🟠 HIGH | No SAST / dependency (CVE) / secret scanning in CI | SOC2 CC7/CC9 |
| F7 | 🟠 HIGH | `AuditLog` is mutable + delete permission exists — not tamper-evident | SOC2 CC6/PI1 |
| F8 | 🟡 MED | No data-portability/export endpoint (Art.20) | GDPR Art.20 |
| F9 | 🟡 MED | Sentry/log scrubber misses `email`/`name`/`phone` + several headers | GDPR Art.32 |
| F10 | 🟡 MED | No env/config schema validation at boot | SOC2 CC |
| F11 | 🟡 MED | Audit-event coverage incomplete (login/logout/role-change/org ops missing) | SOC2 CC6/CC7 |
| F12 | 🟡 MED | Invitation token validation endpoint weakly rate-limited (brute-force) | VAPT |
| F13 | 🟡 MED | Chat message content & audit `data` stored plaintext at rest | GDPR Art.32 |
| F14 | 🟡 MED | Wildcard domain validation accepts over-broad patterns (`*.com`) | VAPT |
| F15 | 🟡 MED | No documented backup / DR / RPO-RTO | SOC2 A1 |
| — | 🔵 LOW | Health endpoint leaks version/uptime; dev `.env` secret hygiene; cookie `SameSite`; n8n response not schema-validated; DB least-privilege/RLS undocumented | Mixed |

---

## 2. What's already done well (keep / document as controls)

These are real, verified strengths — and for SOC 2 they become **evidence of controls** once documented:

- **Auth0 JWT validation** — JWKS, RS256, issuer + audience + expiry verified; JWKS fetch rate-limited.
- **Secret encryption at rest** — `CryptoService` AES-256-GCM with random IV + auth tag; key validated at boot (length-checked). `AgentSecret.webhookUrl` encrypted on write, decrypted on read. ✅ VERIFIED
- **Security headers** — helmet; prod CSP `default-src 'none'`, HSTS 1yr + includeSubDomains, `X-Frame-Options: deny`, hidden `X-Powered-By`.
- **Input validation** — global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; Zod schemas in `packages/validation`.
- **CORS** — dashboard locked to exact origin (no reflection, credentials only on exact match); widget validated per-agent `allowedDomains` with cache.
- **Rate limiting** — Redis sliding-window; 100/min authed, 30/min public, per-device message limits (10/min, 100/hr).
- **HMAC** — `timingSafeEqual` constant-time comparison, length pre-check.
- **Widget XSS** — custom allow-list sanitizer for markdown; no unsanitized `dangerouslySetInnerHTML`.
- **Prisma** — no `$queryRawUnsafe`; the one raw path (analytics timezone) is IANA-validated before interpolation.
- **Sentry scrubber + correlation IDs** — `beforeSend` redaction, AsyncLocalStorage correlation tracking.
- **`.env` hygiene (git)** — no `.env` file is tracked or has ever been committed; `.gitignore` covers all `.env*`. ✅ VERIFIED

---

## 3. Findings (detailed)

### F1 — 🔴 CRITICAL — Cross-tenant IDOR on agent knowledge ✅ VERIFIED
**Where:** `apps/api/src/services/agent-knowledge.service.ts:214-222` (`assertAgentExists`), `apps/api/src/controllers/agents/agent-knowledge.controller.ts` (GET/PUT/POST extract/DELETE)
**What:** `assertAgentExists()` filters only `{ id, deletedAt: null }` — **no `organizationId`**. The controller methods take no `@CurrentUser()` and pass nothing tenant-scoped to the service. Any authenticated user who knows an agent's UUID can **read, overwrite, or delete another organization's knowledge base** — which is injected verbatim into that agent's system prompt. This enables cross-tenant data theft (read another tenant's KB) and prompt poisoning (inject instructions into a competitor's bot).
**Why it matters:** Tenant isolation is the #1 control B2B buyers and SOC 2 auditors probe. A single missing `organizationId` filter breaks it.
**Fix:** Add `@CurrentUser()` to all knowledge controller methods; thread `user` into the service; replace `assertAgentExists` with an org-scoped check (mirror `AgentThemesService.ensureAgentAccess` pattern — `findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null }})`, SUPER_ADMIN bypass explicit). Add a regression test: org-A user, org-B agentId → 404.
**Action:** Audit **every** controller/service for the same pattern (find-by-id without org scope). This is likely not the only place.

### F2 — 🟠 HIGH — No right-to-erasure / hard delete (GDPR Art.17)
**Where:** `organizations.service.ts` (~192-234), `agents.service.ts:336-343`, user deletion paths.
**What:** Deletes set `deletedAt`; PII rows (`User.email/name`, `ChatSession.visitorId`, `ChatMessage.content`, `ChatTrace.userMessage/response`, `AuditLog.data`) persist indefinitely. GDPR requires erasure (or documented redaction + retained event record) on request.
**Fix:** Implement an erasure workflow: `DELETE /account` (+ org delete) → queue → scheduled hard-delete/anonymization (null `visitorId`, scrub email/name to a tombstone, cascade-delete messages/traces), keep a non-PII deletion record for audit. Document SLA (≤30 days).

### F3 — 🟠 HIGH — No data-retention enforcement (GDPR Art.5(1)(e))
**Where:** schema-wide; no cron/cleanup job exists. AI **file** logs rotate 7 days, but DB rows (`ChatSession/Message/Trace`, `LlmUsage`, `AuditLog`) are unbounded.
**Fix:** Add configurable retention (`CHAT_RETENTION_DAYS`, `IP_RETENTION_DAYS`, `TRACE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`) + scheduled purge jobs (cascade `ChatSession`→`ChatMessage`; null `visitorId` after IP window). Publish periods in the privacy policy.

### F4 — 🟠 HIGH — No visitor consent for IP / phone capture (GDPR Art.6/7, Recital 30)
**Where:** `chat.service.ts` (`extractVisitorIp`, ~147-155) stores raw IP into `ChatSession.visitorId`; WhatsApp stores raw phone. Widget has no consent gate.
**Fix:** Document lawful basis (legitimate interest: fraud/rate-limit) + privacy notice in widget; for stricter regimes add a consent gate. Strongly consider IP minimization (truncate IPv4 to /24, IPv6 to /64, or hash with salt) — preserves rate-limit/geo signal, removes host-level identifiability (also see F13).

### F5 — 🟠 HIGH — SSRF via agent `webhookUrl`
**Where:** `agents.service.ts` `setWebhookUrl` (~460-490); outbound `fetch` in `chat.service.ts` (n8n path).
**What:** HTTPS enforced in prod, but no block of `localhost`, `127.0.0.0/8`, `169.254.169.254` (cloud metadata), `10/8`, `172.16/12`, `192.168/16`, `::1`. An admin (or anyone who can set the URL) can point it at internal services / instance-metadata and have the server fetch it.
**Fix:** Validate hostname on save AND resolve-and-recheck at request time (DNS-rebinding-safe): reject private/link-local/loopback IPs; ideally pin the resolved IP. Add allow-list option for enterprise.

### F6 — 🟠 HIGH — No SAST / SCA / secret scanning in CI (SOC2 CC7.1, CC9.1)
**Where:** `.github/workflows/ci.yml` runs lint/types/test/build only.
**Fix:** Add `bun audit` (fail on high), a SAST step (Semgrep/CodeQL), and GitHub secret scanning + Dependabot. Add a pre-commit secret scan (gitleaks/trufflehog). This is table-stakes evidence for SOC 2.

### F7 — 🟠 HIGH — Audit log not tamper-evident; delete permission exists (SOC2 CC6/PI1)
**Where:** `prisma/schema.prisma:289-306` (`AuditLog`); RBAC defines `AuditLog:Update` / `AuditLog:Delete`.
**What:** No DB trigger/grant prevents UPDATE/DELETE; RBAC even grants delete to admins. A compromised admin or DB role can rewrite history. (Downgraded from a reported "CRITICAL": exploitation needs privileged access, but it's a real SOC 2 integrity gap.)
**Fix:** `REVOKE UPDATE, DELETE ON audit_logs` from the app role; add BEFORE UPDATE/DELETE triggers that raise; remove `AuditLog:Update/Delete` from the permission matrix; (phase 2) hash-chain rows for tamper evidence.

### F8 — 🟡 MEDIUM — No data portability/export (GDPR Art.20)
Add an authenticated `GET /account/export` returning the user's data (profile + conversations) as JSON. Today only an export *log* event exists, not the data.

### F9 — 🟡 MEDIUM — Scrubber misses PII keys/headers (GDPR Art.32)
**Where:** `apps/api/src/common/sentry/sentry.scrubber.ts` — `SENSITIVE_KEYS` = `password|secret|token|apikey|api_key|credential|authorization`. Misses `email`, `name`, `phone`, `visitorId`; scrubbed headers miss `cookie`, `x-api-key`, `xi-api-key`. Pino app logs not centrally redacted.
**Fix:** Extend regex + header list; reduce `event.user` to `{ id }`; add a redaction serializer to Pino; unit-test with realistic PII.

### F10 — 🟡 MEDIUM — No boot-time config validation
`ConfigModule.forRoot` has no schema. Add Joi/Zod `validationSchema` so missing `DATABASE_URL`/`AUTH0_*`/`AGENT_SECRET_KEY`/(prod) `SENTRY_DSN` fail fast.

### F11 — 🟡 MEDIUM — Incomplete audit coverage (SOC2 CC6/CC7)
Missing events: login success/failure, logout, role/permission change, invitation acceptance, org membership add/remove, secret rotation, data export. Add domain loggers for these via the existing `TracerService`.

### F12 — 🟡 MEDIUM — Invitation token brute-force
**Where:** `invitations.controller.ts` `GET /invitations/validate/:token` (`@Public`, only global 30/min/IP).
**Fix:** Tight per-endpoint limit (e.g. 5/min) + lockout/backoff after N failures. (Tokens are UUIDv4 so guessing is impractical, but defense-in-depth + abuse logging.)

### F13 — 🟡 MEDIUM — Plaintext sensitive content at rest (GDPR Art.32)
`ChatMessage.content`, `ChatTrace.userMessage/response`, `AuditLog.data` are plaintext (unlike the encrypted `AgentSecret`). Acceptable with DB-level encryption + access control, but for regulated buyers consider app-layer encryption (opt-in "sensitive mode") and/or PII-redaction-before-store. At minimum add a UI notice ("don't paste card/PII").

### F14 — 🟡 MEDIUM — Over-broad wildcard domains
**Where:** `utils/domain.ts` accepts `*.com`. Enforce ≥2 labels after `*.`.

### F15 — 🟡 MEDIUM — No documented backup/DR (SOC2 A1)
Document Supabase PITR window, RPO/RTO, monthly restore test, and audit-log archival. Required for the Availability criterion.

### LOW
- **Health endpoint** returns `version`/`uptime` publicly → move detail behind auth.
- **Dev `.env` hygiene** — `apps/api/.env` holds real-looking dev/staging secrets on disk (gitignored, never committed ✅). If those keys are shared/reused, rotate and move to a secret manager; keep encryption key out of `.env` in prod.
- **Cookie `SameSite=Lax`** on widget device id → `Strict` unless cross-site embedding needs Lax.
- **n8n response** parsed without schema validation → add Zod parse + size cap.
- **DB least-privilege / RLS / `sslmode=require`** undocumented → document app-role grants, enforce TLS, consider RLS as defense-in-depth for tenant tables.

---

## 4. Corrected / non-issues (verification overturned these)

- ❌ **"Production `.env` with live secrets is exposed/committed (CRITICAL)"** — **False as a git exposure.** No `.env` is tracked or in history; `.gitignore` covers them. It's a local dev file. Real (lower) risk = dev secret hygiene/rotation only. ✅ VERIFIED
- ❌ **"`AgentSecret.apiKey`/`webhookUrl` stored plaintext"** — **False.** Encrypted via `CryptoService` AES-256-GCM before persistence. ✅ VERIFIED
- ⬇️ **"Audit log tampering = CRITICAL"** — real integrity gap but requires privileged DB/admin access → **HIGH** (F7).

---

## 5. Compliance readiness scorecard

| Area | Status | Blocking gaps |
|------|--------|---------------|
| **GDPR** | 🟠 Partial | Erasure (F2), retention (F3), consent (F4), portability (F8), scrubbing (F9), plaintext PII (F13). Needs: privacy policy, sub-processor list + DPAs/SCCs, RoPA, DPA template for customers. |
| **SOC 2** | 🟠 Foundations only | Audit immutability+coverage (F7,F11), CI security scanning (F6), config validation (F10), DR/backup docs (F15). Needs: documented policies (access, change mgmt, incident response, vendor mgmt), least-privilege DB, log retention policy. Most gaps are **process/docs**, not code. |
| **VAPT (app surface)** | 🟠 One critical | F1 IDOR (fix first), F5 SSRF, F12 brute-force, F14 wildcard. After fixes, commission an external pen test. |
| **B2B enterprise-ready** | 🟠 Not yet | Tenant-isolation hardening (F1 + sweep), data residency option, SSO/SAML (you have Auth0 — expose enterprise connections), audit-log export for customers, status page/SLA, security page + sub-processor list. |

**Data sub-processors receiving PII (document these for GDPR/DPA):** Auth0 (auth), Sentry (errors), OpenRouter/LLM providers (chat text), ElevenLabs/Sarvam/Deepgram (voice audio + transcripts), Supabase (database), object storage (uploads). Each needs a DPA + (for US transfer) SCCs, listed in a public sub-processor page.

---

## 6. Prioritized remediation roadmap

**P0 — this week (security-critical, code):**
1. F1 fix + codebase-wide IDOR sweep (org scoping on every find-by-id) + regression tests.
2. F5 SSRF guard on `webhookUrl` (save-time + request-time).
3. F6 add `bun audit` + secret scanning + Dependabot to CI.

**P1 — 2–4 weeks (GDPR rights + SOC2 integrity):**
4. F2 erasure flow, F3 retention jobs, F8 export endpoint.
5. F7 audit immutability (revoke + triggers, drop delete perm), F11 event coverage.
6. F9 scrubber expansion, F10 config validation, F12 invite throttle.

**P2 — 1–2 months (regulated/enterprise polish):**
7. F4 consent + IP minimization, F13 sensitive-data handling, F14 wildcard fix.
8. F15 DR/backup docs, DB least-privilege/RLS, health endpoint.
9. Policy/doc set: privacy policy, sub-processor list, DPA template, RoPA, access/change/incident/vendor policies.
10. Commission external VAPT; pursue SOC 2 Type I → Type II.

---

_Generated from a 5-pass static review on 2026-05-31. Findings without a ✅ VERIFIED marker should be confirmed at the cited location before remediation. This document is intended as a working tracker, not a formal attestation._
