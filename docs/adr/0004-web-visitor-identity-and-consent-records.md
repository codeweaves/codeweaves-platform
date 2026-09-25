# ADR-0004: Web visitor identity and consent records

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Dhruv

## Context

The DPDP Act makes a business that embeds our widget the **data fiduciary**. We are its **data processor**. Section 5 and Rule 3 require a notice before collection that links to the business's own privacy policy. Section 6 consent needs "a clear affirmative action". Section 6(4) says withdrawal must be as easy as giving consent. Section 6(10) puts the burden of proof on the fiduciary: it must be able to prove that the notice was given and that consent was obtained. Rules 3 and 5 to 16 take effect on about 13 May 2027.

Section 6(10) means a banner alone is not enough. Someone must keep proof. That proof lives on our servers, because the visitor's decision is made in our widget.

A consent record needs a key: who agreed. Before this decision, `chat_sessions.visitorId` held `vh_<HMAC of the client IP>` for web visitors and the phone number for WhatsApp. An IP is the wrong key for a person:

- Indian mobile carriers put very many subscribers behind one public IP (carrier-grade NAT). A consent keyed to an IP would count everyone on that IP as consented.
- For the same reason, `DELETE /privacy/visitors/:visitorId` could erase other people's conversations. It could also miss the visitor's own conversations after their mobile IP changed.
- `total_users` and "returning users" in analytics counted IPs, not people.

The widget already creates a random v4 UUID per browser (`cw_device_id`, kept in localStorage with a cookie fallback, for one year) and sends it on every request as `X-Device-Id`. Until now, only the rate limiter read it.

Two more facts shaped the design:

- `agent_themes.config` is overwritten in place on every save and keeps no history. The theme audit event (`AGENT_THEME_UPDATED`) records who saved, not what changed. So without a new store, nobody can say later which notice wording a visitor saw.
- Production consent systems split the record into an append-only event log plus a notice version (Kantara Consent Receipt, ISO/IEC TS 27560, OneTrust receipts, the `revision` field in orestbida/cookieconsent). Chat vendors such as Chatwoot and Crisp identify an anonymous visitor by a random per-browser ID until the visitor gives an email.

## The four questions

- **Blast radius:** medium. If the identity choice is wrong, erasure and unique-visitor counts are wrong for web visitors in every tenant. If the gate is wrong, either chats open without consent (compliance) or valid visitors are locked out (every consent-mode widget). WhatsApp is not affected.
- **One-way or two-way door:** mostly two-way. `visitorId` is a string column, and new sessions can start writing a different value at any time. Consent rows are append-only, so the rows we write are permanent. Their shape can still grow.
- **Couples us to:** the widget's device ID in browser storage (lost when the visitor clears it; Safari expires script-written storage after 7 days without a visit), and the SHA-256 notice hash as the notice revision.
- **Cost of waiting:** high. Every web session written with an IP key is one we cannot erase or count correctly. We are pre-launch, so today the data is small and mostly test data.

## Decision

**1. Web visitor identity = the hashed device ID.**

| Channel                                          | `chat_sessions.visitorId`            |
| ------------------------------------------------ | ------------------------------------ |
| Web widget and its voice input                   | `vd_<HMAC of X-Device-Id>` (new)     |
| Web, rows written before this ADR                | `vh_<HMAC of IP>` (left as they are) |
| WhatsApp                                         | the phone number (no change)         |
| Future channels (Instagram, Messenger, Telegram) | a prefixed platform ID, e.g. `ig_…`  |

- `CryptoService.hashVisitorDevice` accepts only a v4 UUID and uses its own HMAC domain (`visitor-device-hash-v1`). Any other header value gives no identity.
- The IP hash moves to a new attribute column, `chat_sessions.ipHash`. It is for abuse checks and evidence only. It is never an identity.
- We keep one `visitorId` column. `(source, visitorId)` says who, on which channel. We do not add a column per platform.
- The device ID is created when the visitor first uses the chat, not on page load. The load-time warmup call sends one only if it already exists (EDPB Guidelines 2/2023 on storage in the visitor's browser).

**2. Consent records: an append-only `visitor_consents` table.**

- One row per decision (GRANTED or WITHDRAWN), never updated. The current state is the latest row for `(agentId, visitorId)`.
- Each row stores a snapshot of what the visitor saw: notice text, link text, policy URL and button label. It also stores `noticeHash`, a SHA-256 of those fields, plus `method`, `source`, `ipHash` and `organizationId`.
- The snapshot is taken from the server's copy of the notice, never from the request.
- `chat_sessions.consentId` points to the consent a conversation ran under (ON DELETE SET NULL).

**3. The client owns the notice; we record and enforce it.**

- Config lives in the widget theme JSONB (`consent` section, all fields defaulted, `enabled` defaults to false). No theme migration is needed.
- Two modes, chosen by the client: `notice` (a line and a link, the chat works at once) and `consent` (the input stays locked until the visitor clicks, and a GRANTED row is written).
- The notice is live only when it is enabled AND has an `https://` policy link. The theme service refuses to save "enabled" without a link.
- **Enforcement is on the server.** In consent mode, creating a new session requires a GRANTED row whose `noticeHash` matches the live notice. Otherwise the server returns 403 `CONSENT_REQUIRED`, with the live notice in the body, so a widget with a stale cached config can show it at once.
- Text chat checks when a session is created. A withdrawal expires the visitor's open sessions, so their next message has to go through the check again.
- Voice checks **before every speech-to-text call**, because STT sends the audio to a third-party provider, and a client-sent `sessionId` proves nothing: it can be stale, expired, or made up.
- **Every source except WhatsApp is gated, including `DEMO`.** `source` is a word the caller sends, with no login behind it, so it must never unlock anything. The public demo page shows the same notice and button as the widget.
- A changed notice gets a new hash, so every visitor is asked again. A grant against a stale hash returns 409 with the current notice.
- A withdrawal always succeeds, and it expires the visitor's open bot sessions on that agent.
- **Who may edit it:** a separate permission, `AgentTheme:UpdateConsent`, granted through the add-on role `org.agent_privacy`. `org.owner` and `platform.agent_admin` hold it by default, because the owner is the data fiduciary. `org.agent_editor` does not. As with branding, the check is field-level in `AgentThemesService`, because the notice shares one JSONB column with appearance. Without the permission, the stored notice is kept on PUT, PATCH and reset.

**4. Logging.**

| What happens                | `audit_logs`                                                           | `event_logs`                              |
| --------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| Teammate changes the notice | `AGENT_CONSENT_NOTICE_UPDATED` with before/after wording and hash      | HTTP envelope (automatic)                 |
| Visitor grants / withdraws  | `VISITOR_CONSENT_GRANTED` / `_WITHDRAWN` (no visitorId in the payload) | `WIDGET_CONSENT_GRANTED` / `_WITHDRAWN`   |
| Server refuses a session    | none                                                                   | `WIDGET_CONSENT_REQUIRED` with the reason |

**5. Data-subject rights.** Visitor erasure deletes the visitor's consent rows (org-scoped, even when there are no sessions). The access summary lists the consent history.

## Options rejected

### Keep the IP hash as the visitor key

**Good:** no identity change and no new moving part. It works in browsers that block all storage, and it cannot be cleared by the visitor.

**Rejected because:** carrier NAT makes one IP many people. That breaks consent, and it makes erasure delete other people's data.

### Add a `deviceId` column and leave `visitorId` as the IP hash

**Good:** the smallest change. No existing reader of `visitorId` sees a new value.

**Rejected because:** erasure, access and analytics would keep keying on the IP, so the wrong-person erasure bug would stay. Two identity columns also invite the next feature to pick the wrong one.

### A `visitors` + `visitor_identities` table now (Chatwoot's contacts / contact_inboxes)

**Good:** it models one person across channels and allows merging a web visitor with the same person on WhatsApp.

**Rejected because:** no feature needs cross-channel merging yet, and it would touch every session reader. The prefixed `(source, visitorId)` pair moves to this model cleanly later.

**Revisit if:** we want one contact across channels, or a second social channel lands.

### A versioned `consent_notices` table referenced by each consent row

**Good:** it is normalised, it matches ISO 27560's notice-by-reference, and it makes "list every notice version" a simple query.

**Rejected because:** it needs versioning logic on every theme save. A snapshot on the row is complete proof in one row, with no join. At our scale the duplication costs about 300 bytes per decision. The `AGENT_CONSENT_NOTICE_UPDATED` audit trail already gives the version history.

**Revisit if:** notices grow large (for example, many languages per agent), or a client needs a notice-version report.

### Enforce consent only in the widget

**Good:** no server work on the chat path at all.

**Rejected because:** the widget runs in the client's page and anyone can call our public endpoints directly. The security rules require guardrails at the boundary. Without a server check, the proof would be only as good as the page's JavaScript.

### Store the consent decision only in the browser (Klaro-style)

**Good:** no personal data on our side for the decision itself.

**Rejected because:** Section 6(10) needs proof that the fiduciary can produce. A value in the visitor's own browser proves nothing to anyone else.

## Consequences

- Erasure and access now reach exactly one browser's data, not everyone behind an IP.
- Unique-visitor analytics become per browser. Numbers change at deploy: they rise where many people shared an IP, and they fall where one person's IP rotated. Old and new rows use different keys, so a visitor active across the deploy counts twice for a short period.
- A device ID is per browser, not per person. The same person on a phone and a laptop is two visitors. Incognito mode or cleared storage makes a new visitor, who is asked for consent again. Safari's 7-day storage cap does the same.
- `X-Device-Id` is client-controlled. It is an identifier, not an authenticator. A forged value only creates a new, empty visitor.
- The first message of each new session costs one extra database round trip: the theme and the latest consent row are read in parallel. Text turns on an existing session cost nothing. Every voice turn pays that round trip before STT, which is small next to the STT call itself.
- Sessions that were open when a client turns on consent mode keep running until they rotate. A reload always starts a new session, so this window is short.
- A withdrawal during a live human handover does not expire that session. The widget disables the withdraw link while a teammate is live.
- New code paths that open a session must go through `ChatService.resolveOrCreateSession`, or through `ConsentService.assertConsented` when they send visitor data to a third party before a session exists. No client-sent field may skip the check.

## Open questions

- **WhatsApp notice and consent (phase 2).** This is an in-thread flow: a notice in the first reply, or WhatsApp reply buttons, and holding the first message until "Agree". The table already supports it (`source = WHATSAPP`, `visitorId` = phone). Decider: Dhruv.
- **Consent records after erasure.** Today, erasure deletes the visitor's consent rows, and only a counts-only audit entry remains. A client's lawyer may want minimal proof kept for past processing. That decision belongs to the client and their lawyer. Changing it later only means keeping rows that we delete today.
- **Retention floor.** DPDP Rule 8(3) requires processing logs to be kept for at least one year from May 2027. `CHAT_TRACE_RETENTION_DAYS` defaults to 90. This is outside this ADR but was found while writing it.
