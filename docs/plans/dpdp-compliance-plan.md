# DPDP Compliance Implementation Plan

**Status:** proposed — awaiting go-ahead
**Author:** drafted 2026-07-24
**Related:** `docs/security/security-compliance-audit-2026-05-31.md`, `docs/security/idor-authorization-audit-2026-07-12.md`

## Context

- India's **DPDP Act 2023 + DPDP Rules 2025** (notified 13 Nov 2025). Core obligations
  (consent, privacy notice, security safeguards) become enforceable **13 May 2027**.
- Platform is **pre-launch with zero production user data.** This means data-shape changes
  (encryption, IP hashing, storage changes) carry **no migration risk** — the single best
  time to make them. This plan is deliberately front-loaded on those.
- Scope here = **engineering + document drafts.** Legal *validity* of the policy text needs a
  lawyer's review; that's the only out-of-code dependency.

## Obligation → deliverable map

| DPDP obligation | What we build |
|---|---|
| Consent + privacy notice (clear, plain language) | Privacy Policy doc (S6); widget notice (S5) **DEFERRED** at user request 2026-07-24 |
| Right to erasure / correction | Erasure engine: per-visitor + org-wide delete (S2) |
| Right to access (summary of data + processing) | Per-visitor data summary endpoint (S3) |
| Reasonable security safeguards (encryption / masking / access control / logs ~1yr) | Encrypt lead data + hash IP (S1); retention/purge job (S4) |
| Grievance redressal + breach process | Grievance/breach doc + published contact (S6) |
| Processor contracts | DPA template (S6) — used when signing B2B clients |

## Workstreams (stories)

### S1 — Data-handling hardening *(do first; risk-free with no existing data)*
- Encrypt `CollectedData.data` at rest via existing `CryptoService` (reversible — still shown in dashboard).
- Store `ChatSession.visitorId` for web as an **HMAC hash** of the IP (deterministic → distinct-user
  counting, returning-visitor logic, rate-limiting all still work; raw IP no longer retained). WhatsApp
  phone handling reviewed separately.
- **Do NOT encrypt chat message content** — it must stay searchable/analysable; it's protected by
  DB-at-rest + access control instead.
- Verify + update every consumer of the raw IP before switching.
- AC: new writes encrypted/hashed; dashboard reads decrypt correctly; analytics unaffected; unit tests.

### S2 — Erasure engine
- `PurgeService` that deletes by id set across **all** tables holding subject data, including the
  FK-less ones (`chat_traces`, `pii_tokens`, `event_logs`, `llm_usage`) that today would orphan.
- **`event_logs` deletion uses its existing indexed columns** (`organizationId`, `agentId`,
  `sessionId`, `visitorId`) via explicit `DELETE ... WHERE` — NO foreign key is added. Rationale:
  event_logs is a fire-and-forget, high-write observability table that must never break a service;
  a hard FK validates on every insert (fails on pre-auth/no-org events and agent-deleted-mid-request
  races) and adds hot-path overhead. Index-scoped deletes give the same erasability without coupling.
- Endpoints: **org-wide hard delete** (admin — also cleans your own test data) and **per-visitor
  erasure** (by visitorId, tenant-scoped).
- AC: erasing a visitor removes every row referencing them; org delete removes everything; both
  tenant-auth guarded; irreversibility guarded (explicit scope + confirm); unit tests.

### S3 — Access / data summary
- Per-visitor endpoint returning what we hold (sessions, messages, collected fields) + processing
  purposes, as JSON. (DPDP needs a *summary*, not GDPR-style portability — keep it simple.)
- AC: returns a visitor's complete footprint; tenant-scoped; unit test.

### S4 — Retention / purge job
- Per-table retention windows (industry-standard tiers, all configurable), triggered via the existing
  **external-cron → internal endpoint (x-internal-secret)** pattern, not an in-process cron.
- **Industry-anchored defaults (matches OpenAI/Zendesk/SOC 2):**
  - `chat_messages`, `collected_data` (conversations + leads = product data) → **NOT auto-deleted**; removed only via S2 erasure (on request, ≤30 days).
  - `chat_traces`, `ai-trace.log` (AI debug traces) → **90 days**, then trimmed.
  - `event_logs` (operational "what happened when") → **365 days**, then trimmed.
  - `audit_logs` (admin/security actions) → **365 days+** (longest; keep for accountability).
- AC: rows older than each window purged; disabled-safe (window=0 → no-op); logs what it dropped; test.

**Decision (2026-07-24):** `event_logs` **keeps full request/response payloads** (incl. message
content) — the owner wants complete envelopes for forensics ("what happened when"). This is
compliant because event_logs is brought into the lifecycle, NOT by stripping content:
- S2 erasure MUST delete event_logs rows for an erased subject (match on `visitorId`/`sessionId`/`organizationId`).
- S4 retention trims old event_logs rows on the window.
- Verify the payload size cap (`capJson`) is generous enough not to truncate real chat messages.
Principle: duplication is fine when every copy is access-controlled + deletable + time-bounded.

### S5 — Widget notice + consent — **DEFERRED (parked 2026-07-24 at user request)**
- One-line notice + Privacy Policy link at chat start (per-agent config toggle, default on). Optional
  affirmative "start chat" acknowledgement.
- AC: notice shown at/before first message; links resolve; toggle in agent config; no layout break in Shadow DOM.
- NOT in the current build loop. Revisit closer to launch.

### S6 — Policy documents (drafts; founder fills company specifics)
- Privacy Policy (DPDP-aligned) · Subprocessor list (from verified inventory) · DPA template · Grievance + breach process.
- Founder-supplied blanks: legal company name, registered address, grievance contact email.

## Sequence

1. **S6 docs** — parallel, zero code risk.
2. **S1 data hardening** — do while there's no data to migrate.
3. **S2 erasure engine** — spine; also cleans test data.
4. **S3 access summary** — small, reuses S2's table map.
5. **S4 retention job** — reuses existing cron pattern; also handles the PII-in-logs surfaces (`chat_traces`, `event_logs`, `ai-trace.log`).
6. ~~S5 widget notice~~ — **deferred**, not in this loop.

## Goal (loop exit condition)

**Definition of done** — the loop terminates when ALL of these hold:
- S6, S1, S2, S3, S4 implemented per their acceptance criteria.
- Every new/changed `apps/api` controller + service has unit tests in `apps/api/test/`.
- `bun run lint` · `bun run check-types` · `bun run build` · `bun run test:cov` all pass.
- Policy docs (privacy policy, subprocessor list, DPA template, grievance/breach) exist with `[PLACEHOLDER]` tags for founder-supplied fields.
- `graphify update .` run after code changes.

**Loop discipline (per iteration):** implement exactly ONE story → write + run its unit tests → run lint/check-types/build → self-review for scale (10K users / many orgs) → record progress in the tracker section below → continue to the next story WITHOUT surfacing to the user. **User directive (2026-07-24): do NOT report between stories — complete ALL stories, then present ONE final report.** No `git commit`/push/PR at any point — the user reviews the full working-tree diff at the end and decides how to commit.

## Progress tracker (loop state — update each iteration)

- [x] S6 — policy docs — DONE 2026-07-24: `docs/legal/privacy-policy.md`, `subprocessor-list.md`, `dpa-template.md`, `grievance-and-breach-process.md` (all with [PLACEHOLDER] tags)
- [x] S1 — data hardening — DONE 2026-07-24: `CryptoService.hashVisitorIp` (HMAC, domain-separated, loopback→undefined) wired at all 4 capture sites (public-chat ×3, voice ×1); `encryptFieldValues`/`decryptFieldValues` (values encrypted `enc:v1:`, keys plaintext for jsonb_object_keys) wired into data-extraction (decrypt→merge→encrypt) + agent-data-fields (decrypt on read). WhatsApp phone untouched (outbound needs it). 4 specs updated (resetMocks-safe), 13 new crypto tests. 125 tests green, types+lint green.
- [x] S2 — erasure engine — DONE 2026-07-24: `PurgeService` (eraseVisitor org-scoped + eraseOrganization hard-delete), children-first idempotent deleteManys (no giant transaction), FK-less tables by indexed scope columns, org purge memory-safe (no id lists), storage cleanup per bucket, counts-only audit proof records. `PrivacyController`: DELETE /privacy/visitors/:visitorId (CLIENT pinned to own org) + DELETE /privacy/organizations/:orgId?confirm=<orgId> (SUPER_ADMIN, double-entry). PrivacyModule registered. 17 tests green, types+lint green.
- [x] S3 — access summary — DONE 2026-07-24: `PurgeService.summarizeVisitor` (sessions w/ message counts, decrypted collected-data fields, record counts for traces/eventLogs/piiTokens/llmUsage, processing purposes) + `GET /privacy/visitors/:visitorId/summary` (same org-pinning as erasure, shared resolveOrgScope). Read-only verified by test. 21 privacy tests green, types+lint green.
- [x] S4 — retention job — DONE 2026-07-24: `DataRetentionService` (chat_traces default 90d armed, audit_logs default 0=keep, event_logs delegated to existing EventLogRetentionService/EVENT_LOG_RETENTION_DAYS), batched 5k deletes (no long locks), `POST /internal/retention/run` (x-internal-secret, external-cron pattern), env vars documented in apps/api/.env.example. Product data (chat_messages/collected_data) explicitly never touched. 7 tests green.
- [x] Final — VERIFIED 2026-07-24: monorepo lint ✓ check-types ✓ build ✓ test:cov ✓ (114 suites / 1990 tests), graphify updated. Branch `feature/dpdp-compliance`, uncommitted — awaiting founder review.

**Founder-supplied blanks (non-blocking — placeholders used until provided):** legal company name, registered address, grievance contact email.

## Risks / guardrails

- **Deletion is irreversible** → explicit id scoping, tenant guards, tests, confirm step on org delete.
- **Encryption kills SQL search** on that column → only encrypt display-only lead data, never chat content.
- Each story: feature branch, unit tests (apps/api), `lint` + `check-types` + `build` + `test:cov`, then code review per project workflow. Must scale to 10K+ users across many orgs.

## Out of scope

- Legal sign-off of policy wording (lawyer review).
- DPO / DPIA / audits — only for a "Significant Data Fiduciary" (volume-based; not us at launch).
- Consent Manager infrastructure (optional; registration opens Nov 2026).
- Verifiable parental consent for minors — revisit only if agents target under-18 audiences.
