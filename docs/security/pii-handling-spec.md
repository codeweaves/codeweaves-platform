# PII Handling Spec (source of truth)

Status: APPROVED (decisions locked 2026-08-11). Supersedes the tier decisions in
`docs/plans/pii-redaction-plan.md` (that doc's detection/checksum design still
stands; only the per-category tiers + storage rules below are authoritative).

This spec defines exactly which PII we keep, where, in what form, and why, so a
customer's security/IT reviewer can be answered in one place. It was written
after a live test of the production widget confirmed the current behaviour (see
`memory` note `project-widget-security-assessment-2026-08-11`).

---

## 1. The one rule everything follows

Every regime we care about (India DPDP + UIDAI, US GLBA + state SSN laws, EU/UK
GDPR, and PCI DSS for cards) agrees on the same baseline:

> **Do not keep what you do not need. If you keep it: encrypt at rest (AES-256),
> TLS in transit, show only the last 4 on display, and restrict who can reveal
> the full value.**

We already have AES-256-GCM (`CryptoService`), TLS, and per-tenant isolation.
This spec applies that baseline consistently and fixes the gaps.

---

## 2. Three tiers

| Tier | Meaning |
|---|---|
| **DESTROY** (was "HARD_DROP") | Real value is masked to last-4 (or fully redacted) at ingestion and **never** stored anywhere. Irreversible. |
| **VAULT** (was "TOKENIZE") | Transcript + LLM see a stable token (`[BANK_ACCOUNT_1]`). The real value lives **only** in the encrypted `pii_tokens` vault. Reversible by an authorised human/tool, audited. |
| **ALLOW** | Stored as plain text on purpose (business needs it as lead data). |

---

## 3. Category → tier (authoritative)

| Category | Tier | Reason |
|---|---|---|
| Credit/debit card | **DESTROY** (keep last-4) | PCI DSS. Storing full cards drags the whole system into PCI scope. We have no payment reason to. Keep `****1111`, drop the rest. |
| Aadhaar | **DESTROY** | UIDAI: Aadhaar may live **only** in a certified "Aadhaar Data Vault" (HSM, reference keys, UIDAI-audited). Our generic vault does not qualify. Not worth it for a chatbot. |
| Passport, Driving Licence, Voter ID | **DESTROY** | High-harm national IDs, no product use. |
| **PAN** | **VAULT** (last-4) | Indian tax ID. Less restricted than Aadhaar; encrypt-at-rest + last-4 display is standard. **Moved from DESTROY.** |
| Bank account | **VAULT** (last-4) | Legitimate BFSI use; keep recoverable + encrypted. |
| DOB | **VAULT** (last-4) | Sensitive but sometimes needed; encrypt + minimal display. |
| IFSC | **VAULT** | Bank routing; human agent may need it, LLM never does. |
| SSN (US) | **VAULT** (last-4) | Add when US launch is live. GLBA + state laws: encrypt + never display > last-4. Detection is a fast-follow (strict dashed pattern + context gate to avoid 9-digit false positives). |
| Email, Phone | **ALLOW** | Lead data, low sensitivity, business wants it. |

**Design rule going forward:** default a new sensitive category to DESTROY. Only
promote to VAULT when a real product use needs the value back.

---

## 4. Where each thing is stored (target)

| Store | Holds | Form |
|---|---|---|
| `chat_messages.content` | the transcript | DESTROY → masked (`[CARD REDACTED ****1111]`); VAULT → **token** (`[BANK_ACCOUNT_1]`); ALLOW → plain |
| `pii_tokens` | VAULT-tier real values | `valueEncrypted` (AES-256-GCM), `valueHash` (session-scoped HMAC), `token`, **`last4`** (new, for masked display) |
| `collected_data.data` | deliberately captured fields | AES-256-GCM encrypted (`crypto.encryptFieldValues`) |
| `chat_traces` | LLM debug view | tokenised/redacted when `piiLogRedaction` on |
| `event_logs` | observability | redacted (no raw bodies) |

The LLM is sent tokens for VAULT tier and masked values for DESTROY tier. It
never sees a raw card/Aadhaar/bank/DOB/PAN.

---

## 5. The vault (`pii_tokens`) — purpose + hard requirements

Purpose: keep an encrypted, recoverable copy of a VAULT-tier value so (a) a human
agent can reveal it when they legitimately need it, and (b) a tool can act on it
mid-conversation, WITHOUT the value ever sitting in the transcript or reaching
the LLM in the clear.

Hard requirements once the transcript stores only the token (this spec):

1. **Durability.** The vault write becomes the *sole* home of the real value, so
   it MUST be durable. Today it is `void piiCtx.flush()` (fire-and-forget) and
   `persist()` swallows errors. That was safe only because the transcript kept a
   raw copy. Under this spec the vault write must be **awaited and must succeed
   before (or atomically with) storing the tokenised message**. If the vault
   write fails, we must NOT store a token whose value we cannot recover — fall
   back to masking that entity instead.
2. **Last-4 column.** Add `last4 String?` to `pii_tokens`, populated on persist
   (never for full-secret categories where even last-4 is sensitive). Lets the
   dashboard show `****9012` without decrypting.
3. **Token stability.** Same value → same token across every turn of a session
   (already implemented via `valueHash`). Storage-time and LLM-time tokenisation
   are deterministic given (session token map, text), so they converge on the
   same token; `createMany({ skipDuplicates })` dedupes the double write.

---

## 6. Data-capture interaction (MUST NOT BREAK)

`DataExtractionService.extractForSession()` reads `chat_messages.content` and
feeds the transcript to the extractor LLM. Once VAULT-tier values are tokens in
the transcript, the extractor would capture `[BANK_ACCOUNT_1]` instead of the
real value.

**Fix:** before building the transcript, detokenise each message via
`PiiTokenizerService.forSession(...)`. The extractor then sees real values,
extracts them, and `crypto.encryptFieldValues` encrypts them into
`collected_data` (already the case). Real values live only transiently in memory
and encrypted at rest. This keeps deliberate capture working AND compliant.

This is the correct division: the *transcript* hides the value; a *declared
data-capture field* is the lawful-basis path to actually keep it (encrypted).

---

## 7. Display + access (dashboard)

- Default view for any VAULT-tier value: **last-4 only** (`****9012`), read from
  `pii_tokens.last4` — no decryption.
- "Reveal full" is a privileged action: allowed only for roles with a business
  need, and **every reveal writes an `audit_logs` entry** (who, when, which
  session/field). This matches US state-law display limits and GDPR minimisation.
- DESTROY-tier values have no reveal (there is nothing to reveal).

Status: not built yet. Backend reveal endpoint + audit + a masked-display
component are a fast-follow after the storage change lands.

### 7a. Captured data (`collected_data`) display

Captured fields are stored as the **real value, encrypted** (not tokens), because
the business declared a purpose for them. Display policy by field sensitivity:

- **Ordinary lead fields** (name, email, phone, company, order no.) → show full.
  Capturing them to use them is the point.
- **Sensitive-identifier fields** (bank, DOB, SSN, PAN) → last-4 + reveal-with-audit,
  same as the transcript vault.
- **Card / Aadhaar** → must NOT be configurable as capture fields (PCI / UIDAI).
  Block at field-config time with an explanatory message.

Today the leads view decrypts and shows everything in full (no masking layer).
Masking sensitive capture fields is part of Phase B.

---

## 8. Data residency (going global)

- All data currently in Supabase **ap-south-1 (Mumbai)**. Fine for India DPDP.
- GDPR prefers EU data in the EU; some clients will require it. Before signing an
  EU client, stand up an EU-region option (separate project or region-routed
  storage). Tracked, not urgent.

---

## 9. Current state vs target (gap analysis)

| # | Item | Current | Target | Risk |
|---|---|---|---|---|
| 1 | PAN tier | DESTROY | VAULT + last-4 | low (config) |
| 2 | VAULT values in transcript | **plaintext** | token | MED — hot path |
| 3 | Vault write durability | fire-and-forget | awaited/atomic | MED — data loss if skipped |
| 4 | Extractor input | raw transcript | detokenised transcript | MED — breaks capture if skipped |
| 5 | `pii_tokens.last4` | absent | present | low (additive migration) |
| 6 | Dashboard masked reveal + audit | absent | present | frontend, fast-follow |
| 7 | Bot claims "we don't store X" | LLM freelances (false) | prompt states the truth, or behaviour matches | low (prompt) |
| 8 | SSN detection | none | VAULT recognizer | fast-follow (US) |

---

## 10. Implementation plan (staged, test each stage)

**Phase A — backend redaction core (one feature branch, needs a live smoke test before merge):**
1. `pii-patterns.ts`: PAN → VAULT (TOKENIZE). Card/Aadhaar/passport/DL/voter stay DESTROY.
2. `pii-tokenizer.service.ts`: add `last4` to persist; add a durable `persistAndConfirm` used by the storage path; keep the fire-and-forget path for the LLM side.
3. New `ChatService` path: user messages store `maskHardDrop` + VAULT-tokenised content, with the vault write durable; on vault failure, mask the entity instead of storing a dangling token.
4. `DataExtractionService.buildTranscript`: detokenise via the vault first.
5. Migration: `ALTER TABLE pii_tokens ADD COLUMN last4`.
6. Unit tests: patterns (PAN now VAULT), tokenizer last4 + durability, chat-service storage tokenisation, extractor detokenisation.

**Phase B — dashboard (separate PR):** masked last-4 display + reveal endpoint + `audit_logs` on reveal.

**Phase C — SSN + EU residency (as US/EU launches approach).**

**Phase D — prompt honesty:** stop the bot asserting storage behaviour it can't guarantee.

---

## 11. Test / verification plan

- Unit: every recognizer tier; tokenize→store round-trips to a token, not raw;
  vault has the encrypted value + last4; detokenised transcript yields real
  values to the extractor; DESTROY-tier still 0 raw hits.
- Live smoke (pre-merge, cannot be done from unit tests): send a message with
  card/PAN/Aadhaar/bank/DOB/email/phone through the real widget, then check the
  DB: transcript has tokens/masks (no raw bank/DOB/PAN), `pii_tokens` has
  encrypted rows + last4, `collected_data` (if a field is configured) still
  captures the real value, and the raw card/Aadhaar appear nowhere.
