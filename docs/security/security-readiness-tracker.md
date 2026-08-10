# Security & Compliance Readiness Tracker

**Created:** 2026-07-25 · **Owner:** Dhruv + co-founder
Groundwork plan (do the free readiness work now; pay for audits only when a client funds them). Word **"compliant" is deliberately NOT used** in product/docs — that's a legal/process claim the founders own.

## Status legend
- ✅ **Done** — built & verified
- 🟡 **Partial / verify** — exists but needs confirmation or finishing
- ⛔ **Not started**
- 🧑 **Needs founder** — infra access, repo-admin, money, or legal (not something the AI can do)

---

## PART 1 — VAPT (free, do now)

| # | Task | Status | Owner | Notes / next action |
|---|---|---|---|---|
| 1.1a | Dependency scan | ✅ Done (ongoing) | AI | `bun audit` (bun monorepo — not npm; no Python). 144 findings = **already-triaged baseline** (PRs #166-168): 2 criticals test-only, highs are dev/build tooling (vite/jest/nestjs-cli), **none prod-runtime-reachable**. Re-run each dep bump. |
| 1.1b | Enable Dependabot | ⛔ / 🧑 | AI scaffolds, founder enables | AI adds `.github/dependabot.yml`; founder flips it on in repo settings. |
| 1.1c | Enable CodeQL | ⛔ / 🧑 | AI scaffolds, founder enables | AI adds CodeQL workflow; founder confirms code-scanning enabled. |
| 1.2 | OWASP ZAP baseline scan | ⛔ | AI writes, runs in CI/box | Target `app.codeweaves.com`. **Exclude paid endpoints** (`/public/chat/*`, `/public/voice/*`, WhatsApp send, invite-email) so it doesn't burn LLM/voice/email spend. Passive/baseline mode. |
| 1.3 | Nuclei scan | ⛔ | AI writes, runs in CI/box | Same target + same exclusions. Non-intrusive templates. |
| 1.4 | Fix all Critical/High | 🟡 | AI | Dep scan: nothing prod-reachable to fix today (documented). ZAP/Nuclei findings: triage after scan; fix or document why not. |
| 1.5 | Purge scan junk data | ✅ capability ready | AI | Erasure engine (`DELETE /privacy/*`) cleans any junk rows a scan creates against the real DB. |

**Note on `app.codeweaves.com`:** it's the real hosted env (live keys + real test data). Scanning it is fine and gives prod-relevant results — we just exclude the paid endpoints so it costs ~nothing. A separate staging is only needed for the **paid pentest** (Part 1b), not this free pass.

---

## PART 1b — Paid pentest prep (later, only when a client funds it)

| # | Task | Status | Owner | Notes |
|---|---|---|---|---|
| 1b.1 | Prod-like staging env | ⛔ / 🧑 | Founder/infra | Needed so pentesters hammer it without touching real data/keys. |
| 1b.2 | Written scope doc | ⛔ | AI drafts | Web app, all APIs, auth/session flows, multi-tenant data isolation. |
| 1b.3 | 2–3 test accounts across tenants | ⛔ | AI + founder | For tenant-isolation testing. |
| 1b.4 | Vendor quotes | ⛔ / 🧑 | Founder | Shortlist: eSec Forte, SecureLayer7 (CREST+SOC2), Kratikal (OSCP+CREST). **Confirm each on official cert-in.org.in list before signing.** Budget ~₹1L–2.5L. Insist free re-test + CERT-In-format report bundled. |

---

## PART 2 — SOC 2 / ISO 27001 readiness (free; same controls cover both)

| # | Task | Status | Owner | Notes |
|---|---|---|---|---|
| 2.1 | Comp AI (trycompai/comp) — clone + generate policy templates | ⛔ | AI generates, founders fill | Self-hostable, covers SOC2/ISO/GDPR. Optionally pull JupiterOne security-policy-templates for extra text. |
| 2.2 | MVSP (mvsp.dev) technical-control checklist (yes/no) | 🟡 | AI | Answerable mostly from code now — see below. |

**MVSP control status (draft — AI to confirm & send as yes/no):**
| Control | Status | Note |
|---|---|---|
| SSO + MFA everywhere | 🟡 verify | Auth is Clerk (supports MFA) — confirm MFA is **enforced**, not just available. |
| Least-privilege IAM | 🟡 verify | App has RBAC roles (CLIENT/ADMIN/SUPER_ADMIN) + tenant scoping. Confirm cloud IAM (Supabase/Render) is least-priv too. |
| Encryption at rest + in transit | ✅ mostly | AES-256-GCM (secrets, lead data), TLS in transit, Supabase disk-encryption at rest. |
| Centralized logging + retention | ✅ | `event_logs` + `audit_logs` + retention sweep (built this week). |
| Secrets manager (no secrets in code/env) | 🟡 / 🧑 gap | Currently `.env`-based. A real secrets manager is likely a gap — needs decision. |
| Automated backups + tested restore | 🟡 / 🧑 verify | Supabase auto-backups exist; a **tested restore** must be confirmed by founder. |

---

## PART 3 — DPDP / GDPR (code parts; legal docs are founder's)

| # | Task | Status | Owner | Notes |
|---|---|---|---|---|
| 3.1 | Consent capture + withdraw | ⛔ | AI | This is the deferred **widget S5**. Not built. |
| 3.2 | Privacy notice at point of collection | ⛔ | AI | Same widget work. Policy text drafted (`docs/legal/privacy-policy.md`), not surfaced in-widget. |
| 3.3 | Per-user data **export + delete** endpoints | ✅ Done | — | `GET /privacy/visitors/:id/summary` + erasure engine (`DELETE /privacy/*`). |
| 3.4 | **Audit log** of personal-data processing | ✅ Done | — | `audit_logs` + org/agent scope + full action coverage (built this week). |
| 3.5 | Breach detection **alerting** | ⛔ | AI | Breach *response process* doc exists (`docs/legal/grievance-and-breach-process.md`); automated detection/alerting **not built**. |
| 3.6 | Sub-processor list (for DPAs) | ✅ Done | Founder signs DPAs | `docs/legal/subprocessor-list.md`: OpenRouter, OpenAI/Gemini/Groq, Deepgram/ElevenLabs/Sarvam, Meta/WhatsApp, Clerk, Supabase, Resend, Sentry. |
| 3.7 | Legal docs (privacy policy, DPA, ToS) | 🟡 / 🧑 | Founder + lawyer | Drafts exist in `docs/legal/` with `[PLACEHOLDER]` tags; founder fills + lawyer reviews. |

---

## This week (recommended order)
1. **1.1b/1.1c** — AI adds Dependabot + CodeQL config; founder enables (when GitHub API is healthy).
2. **1.2 / 1.3** — AI writes the ZAP + Nuclei run scripts (paid endpoints excluded); run against `app.codeweaves.com`; send output.
3. **2.2** — AI sends the MVSP yes/no.
Then decide between Part 2.1 (Comp AI policies) and Part 3 gaps (consent / breach alerting).

## Explicitly deferred / founder-owned (not this week)
- Part 1b staging + pentest vendor (when a client funds it)
- Part 3.1/3.2 widget consent + notice (near launch)
- Legal doc finalization + DPAs (founder + lawyer)
