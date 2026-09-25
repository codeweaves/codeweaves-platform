# ADR-0005: PII-masked logs, no application-level chat encryption

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Dhruv

## Context

Two questions came up together.

**1. Should chat transcripts be encrypted at the application level?** `chat_messages.content` is plain text in Postgres. Supabase encrypts the disk. High-risk identifiers are already removed before storage: cards and Aadhaar are destroyed, and PAN, bank account, DOB and IFSC are replaced with vault tokens. Captured lead fields (`collected_data`) are already encrypted per value.

**2. Where else does conversation text end up?** A code inventory and a query on the dev database found:

- The dashboard HTTP log wrote every Inbox request and response in full to `event_logs`: 18 rows of raw, unmasked teammate replies and 46 rows of whole transcripts, since 19 July. These rows carried no `sessionId`, so visitor erasure never found them.
- A per-agent switch, `piiLogRedaction`, could turn off masking in `chat_traces` and the `ai-trace.log` file. A second switch in the editor, `piiRedactionEnabled`, could turn off masking entirely. The editor even defaulted it to `false` while the server defaulted to `true`.
- The consent endpoint's request log kept the raw `X-Device-Id` header, although the device ID is otherwise only stored hashed (ADR-0004).
- A failed widget, voice or WhatsApp request was logged nowhere with its body.
- Sentry (enabled in production via `SENTRY_DSN`) would receive request bodies on errors, which can hold a visitor's raw message.

The owner's requirement: full visibility ("know what happened and where, no blind spots") **and** compliance.

## The four questions

- **Blast radius:** every log table and every channel. A mistake shows up either as PII in logs (compliance) or as missing detail when debugging (operations).
- **One-way or two-way door:** two-way. Logging and masking rules are code. Nothing here changes a schema.
- **Couples us to:** our own PII recognizers (`pii-patterns.ts`). Masking quality equals detection quality: names and addresses are not detected.
- **Cost of waiting:** high. Unmasked teammate replies were accumulating in logs that erasure could not reach.

## Decision

**One rule: log everything, mask PII in whatever is logged, and send outside services only what they need.**

1. **One helper, `maskPiiDeep` / `maskPiiText`** (`modules/pii/mask-pii.ts`), using the same recognizers as the transcript. Cards and Aadhaar get their drop mask (for example `[CARD REDACTED ****1111]`). PAN, bank account, DOB and IFSC become `[CATEGORY REDACTED]`, never a vault token, so a log line is never a path back to a real value. Email and phone stay readable, as in the transcript.
2. **`event_logs`:** the single writer (`TracerService.logEvent`) masks request and response payloads, metadata and the error message, **before** size capping, so a cut cannot leave half a number. Full bodies stay, for every channel and route.
3. **Failed requests are logged on every channel** (`AllExceptionsFilter`), with the masked body. Widget, voice and WhatsApp were excluded only because their bodies used to be unmasked.
4. **Inbox rows carry the conversation's `sessionId`,** taken from `/handover/:sessionId/...`, so erasure finds them.
5. **AI traces and the `ai-trace.log` file are always masked** at the trace writer: steps at intake, and the text and error at persist. `piiLogRedaction` is ignored.
6. **PII redaction is always on.** The editor toggle is removed, and the server ignores a stored `piiRedactionEnabled: false`. Both keys stay in the schema only so stored configs keep validating.
7. **Visitor erasure keeps log rows as proof.** It empties their bodies, headers and error text, and unsets `visitorId`, instead of deleting the rows. Organization erasure still deletes everything.
8. **`X-Device-Id` is a sensitive header,** dropped from logged headers.
9. **Sentry gets no request bodies.** It gets the error, the stack, the route and the `correlationId` tag; the full masked body is in `event_logs` under the same correlation ID. PII in exception messages, breadcrumbs, `extra` and `contexts` is masked too.
10. **No time-based deletion of event logs** (`EVENT_LOG_RETENTION_DAYS` stays 0). This is the owner's decision: logs are the evidence if a client disputes something later.

## Options rejected

### Application-level encryption of transcripts

**Good:** it protects against a leaked database credential, a leaked service key, a database export, or someone with Supabase dashboard access. BFSI questionnaires ask for it, and Zoho SalesIQ does it.

**Rejected because:**

- Comparable vendors (Intercom, Freshdesk, Chatwoot, Microsoft Dynamics) keep message bodies protected by storage encryption plus access control. Zendesk's paid field encryption excludes comment bodies.
- DPDP Rule 6, ISO 27001 and SOC 2 are risk-based and name no layer. SEBI's CSCRF warns that encrypting all data is infeasible.
- Our tokenising of high-risk identifiers is the "masking or virtual tokens" Rule 6 names.
- It would break the Conversations search, which runs ILIKE over titles, summaries and message text.

**Revisit if:** a BFSI contract demands customer-held keys. Then offer it as a per-client opt-in, with search limited for that client.

### Blind-index (keyword hash) search over encrypted text

**Good:** fast equality lookups on encrypted data. CipherSweet and AWS "beacons" are proven designs.

**Rejected because:** whole words only (prefixes need extra indexes), and per-word hashes of skewed natural language leak through frequency analysis (Cash et al., CCS 2015; Naveed et al., CCS 2015). No Postgres-ready option does substring search.

### Removing conversation text from logs entirely

**Good:** nothing to mask, and the smallest possible logs.

**Rejected because:** the owner requires full visibility. Masking keeps the whole body readable, apart from identifiers.

### Sending masked bodies to Sentry

**Good:** everything needed for debugging is in one place.

**Rejected because:** Sentry is a third party and does not need the text to report a crash. The correlation ID leads to the same body in our own database.

### Deleting event logs after a retention period

**Good:** it limits how long personal data exists in logs.

**Rejected by the owner:** logs are the evidence if a client or visitor disputes something later. Erasure on request still removes a visitor's words from their rows.

## Consequences

- No identifier (card, Aadhaar, PAN, bank account, IFSC, DOB) is stored anywhere outside the encrypted vault. This was verified with canary values sent through the widget, Inbox and error paths: a full database dump and the debug log files had zero raw matches.
- Names and addresses are not detected, so they remain readable in the transcript, logs and traces. That is the same limit as before.
- Every log body is scanned by regular expressions on write. The payloads are small and capped, so the cost is well under a millisecond.
- Debugging a Sentry alert takes one lookup in `event_logs` by correlation ID.
- A client can no longer switch PII redaction off for an agent.
- Logs keep masked personal content indefinitely unless a visitor asks for erasure. The owner accepts this for evidence.
