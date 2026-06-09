# WhatsApp Channel — Architecture & Build Plan

> Status: **Planning / research complete — not started** · 2026-06-08 · Owner: Dhruv
> Supersedes the high-level WhatsApp note in [ai-orchestration-research.md §4](./ai-orchestration-research.md#4-whatsapp-integration) with a platform-grade, multi-tenant design tied to the current codebase.

## TL;DR

Add **WhatsApp as a second channel** alongside the embeddable widget. Customers' end-users
chat with the *same* agent (same system prompt, knowledge, routing) whether they're on the
website widget or on WhatsApp. We integrate the **official WhatsApp Cloud API directly as a
Meta Tech Provider** (no reseller markup), onboard each org's number via **Embedded Signup**,
and reuse the existing channel-agnostic orchestration core. Inbound (user-initiated) support
ships first and is effectively **$0 per message**; outbound (business-initiated) plumbing is
**designed-in but dormant** — turned on later without a schema migration.

---

## 1. Why this is a small change architecturally

Our chat core is already channel-agnostic. The widget is just *one* front-end that calls
[`/public/chat/stream`](../../apps/api/src/controllers/public/public-chat.controller.ts),
which resolves an agent, resolves/creates a session, and runs either `direct` or `n8n`
routing. WhatsApp reuses that exact core. Two facts make this nearly drop-in:

1. **The data model already anticipated WhatsApp.**
   - `ChatSource` enum already has `WHATSAPP` ([schema.prisma:36-40](../../apps/api/prisma/schema.prisma#L36-L40)).
   - `ChatSession.visitorId` is already documented as *"IP address (web/widget) or phone
     number (WhatsApp)"* ([schema.prisma:218](../../apps/api/prisma/schema.prisma#L218)).
   - `ChatSession.source` already drives analytics indexing.

2. **The orchestration core already has a non-streaming entry point.**
   `DirectChatService` exposes both `stream()` (async generator, used by the widget SSE path)
   and **`send()` → `Promise<DirectChatResult>`** ([direct-chat.service.ts:142](../../apps/api/src/modules/ai/direct-chat.service.ts#L142)).
   WhatsApp needs a *complete* message, not a token stream, so it calls `send()`. No new
   orchestration code.

**Consequence:** the n8n "no streaming" limitation (the bottleneck for widget/voice latency)
is a **non-issue for WhatsApp** — WhatsApp can't stream tokens anyway. Both `direct` and `n8n`
routing modes work for this channel unchanged.

---

## 2. Locked decisions (ADR summary)

| Decision | Choice | Rationale |
|---|---|---|
| API surface | **Official WhatsApp Cloud API** (Graph API), never unofficial libs (Baileys / whatsapp-web.js) | Unofficial = ban risk, no SLA, ToS violation. Won't survive 10K-org prod. |
| Provider model | **Direct, as a Meta Tech Provider** (not via a BSP) | Zero per-message markup; we own the customer relationship; we already have the infra (NestJS webhooks, Redis, encrypted-secret model). See §3. |
| Customer onboarding | **Manual config to build → Embedded Signup at launch** | Embedded Signup is Meta's mandated default (Apr 2026) and the industry norm for multi-tenant SaaS. Manual is dev-only (can't enable Embedded Signup until the Tech Provider app is approved). See §4. |
| Billing model | **Tech Provider now** (customer pays Meta via their own WABA payment method); revisit **Solution Partner** later for consolidated billing | Solution Partner approval is long; only needed if we want WhatsApp charges on *our* invoice. |
| Response delivery | **Buffered, non-streaming** via `DirectChatService.send()` | WhatsApp Send API only accepts complete messages. |
| Ingestion | **Queue-first**: verify signature → ACK 200 in <1s → process async on BullMQ (existing Redis) | Meta retries on non-200; sync processing causes timeout/retry cascades. |
| Inbound (MVP) | **Ship first** — user-initiated, free-form within 24h window | No template approval, no per-message cost, ~= the widget. |
| Outbound | **Design-in, leave dormant** — schema/enums/abstractions support it; no template UI / send logic / consent flow built yet | "Good to have, refine later." Turning it on later = add UI + submit templates, **not** a migration. |

---

## 3. ADR: Direct Cloud API vs BSP

**Context.** We resell WhatsApp as a feature to many customer orgs (a *platform*, not a single
business). Two integration models exist.

| | Direct (Tech Provider) | Via a BSP (360dialog / Twilio / Gupshup) |
|---|---|---|
| Per-message cost | Meta raw rate only | Meta rate **+ markup** (~$0.003–0.01/msg, or €49+/mo base) |
| Onboarding infra | We build Embedded Signup | BSP provides it |
| Code to write | Webhook, send, onboarding, templates | Less (BSP wraps it) |
| Meta bureaucracy | Business Verification + app review (~2–5 days, one-time) | BSP shields us |
| Lock-in | None | Tied to vendor pricing/uptime |
| Industry fit | **Standard for product companies** (Wati, Interakt, Tidio-style under the hood) | Shortcut / fast-track |

**Decision: Direct as a Tech Provider.** Across 10K orgs a BSP's per-message markup compounds
into a real recurring bill, and we'd inherit vendor lock-in. The "harder" parts (webhook,
Embedded Signup) are **one-time** builds we're well-equipped for. The only real cost is a
~1-week Meta verification speed-bump — acceptable to avoid permanent markup.

**Fallback:** if Meta verification stalls and we need to demo fast, **360dialog** is the
leanest BSP (near pass-through) for a temporary bridge — but the target is direct.

---

## 4. Multi-tenant onboarding (the crux)

Each org needs its **own** WhatsApp Business Account (WABA) + phone number — you cannot share
one number across tenants. Meta's solution is **Embedded Signup**, an OAuth popup we embed in
our dashboard.

### Embedded Signup flow (Tech Provider)
1. Org clicks **"Connect WhatsApp"** in the web app → Meta-hosted popup opens.
2. Org logs into their Facebook Business, creates/selects a WABA, adds + verifies a phone
   number — all inside the popup (~5–15 min).
3. Popup returns an **auth code** → our backend exchanges it for a **business access token**
   scoped to *their* WABA.
4. We call the Graph API to **register the phone number** and **subscribe our webhook** to
   their WABA.
5. We persist `waba_id`, `phone_number_id`, and the **encrypted** token.

The WABA stays **owned by the org** (revocable access) — clean trust boundary.

### Dev sequence
- **While building (week 1):** wire *our own* test number by pasting `phone_number_id` + token
  into a settings form. (Embedded Signup can't be enabled until the Tech Provider app is
  approved — this is unavoidable, and is what every team does.)
- **At launch:** flip on Embedded Signup for self-serve org onboarding.

---

## 5. Inbound architecture (MVP)

```
Meta Cloud API
  │  (ONE webhook URL for ALL orgs; payload carries phone_number_id)
  ▼
POST /public/whatsapp/webhook        @Public()
  │  GET  → verify-token handshake (respond hub.challenge)
  │  POST → 1. verify X-Hub-Signature-256 on the RAW body (HMAC, app secret)
  │         2. ACK 200 immediately  (Meta retries non-200 → must be fast + idempotent)
  │         3. enqueue job on BullMQ (existing Redis)
  ▼
WhatsApp worker
  │  extract phone_number_id   → resolve owning agent  (O(1) index lookup)
  │  extract `from` (E.164)    → visitorId
  │  dedupe on wa message id   (skip if already processed)
  │  resolveOrCreateSession(source = WHATSAPP, visitorId = phone, deterministic sessionId)
  │  DirectChatService.send(...)   ← reuse existing non-streaming core (or n8n mode)
  │  POST reply → Graph API  /{phone_number_id}/messages
  │  persist ChatMessage rows  (same as widget: user + assistant + metadata)
```

### Reuse map (existing → WhatsApp)
| Existing piece | Reused for WhatsApp |
|---|---|
| `ChatService.resolveOrCreateSession()` | session keyed by phone number, `source=WHATSAPP` |
| `DirectChatService.send()` (`direct` mode only) | unchanged — produces the full reply text |
| `ChatService.saveUserMessage` / `saveAssistantMessage` | message persistence |
| `MessageRateLimitService` ([message-rate-limit.service.ts](../../apps/api/src/services/message-rate-limit.service.ts)) | extend for per-phone-number throttle |
| `AgentSecret` ([schema.prisma:146-157](../../apps/api/prisma/schema.prisma#L146-L157)) | pattern for storing the encrypted WA token |
| Conversations UI | WhatsApp threads appear automatically (filter by `source`) |

### Session keying
`visitorId = customer phone (E.164)`. Deterministic `sessionId` derived from
`phone_number_id + customer phone`, with the existing `Agent.sessionLifetimeHours` rotation
([schema.prisma:124](../../apps/api/prisma/schema.prisma#L124)) still applying — so analytics
"distinct conversations" behave the same as the widget.

### Streaming & typing indicators
**There is no token streaming on WhatsApp.** The Send API only accepts *complete* messages —
you cannot stream tokens into a bubble like the widget's SSE. This is fine and expected:
WhatsApp is async messaging; users expect "typing… → one complete reply", not live tokens.
- We buffer the full reply (via `DirectChatService.send()`) and send once.
- While generating, call the **typing-indicator** endpoint (mark-as-read + typing, lasts up to
  25s or until we send) so the user sees "typing…". This covers the 2–4s LLM latency naturally.
- Optional: chunk a long reply into multiple sequential messages (message-level, not
  token-level) — use sparingly, can feel spammy and ordering isn't guaranteed.
- WhatsApp agents are **`direct`-only** (n8n is out of the picture). Buffered send fits this.

### Voice — two distinct paths
WhatsApp has two unrelated "voice" capabilities. They reuse the existing per-agent
`voiceEnabled` / `voiceConfig` ([schema.prisma:110-111](../../apps/api/prisma/schema.prisma#L110-L111))
and the voice module STT/TTS (Epic 10), but very differently.

**Path A — Voice notes (async audio messages). Available now. Recommended fast-follow.**
```
User sends a voice note → webhook delivers a Media ID (OGG/Opus)
→ authenticated GET to download the file (expires 24–48h — download immediately)
→ STT (existing pipeline) → text
→ DirectChatService.send() → reply text
→ reply per the agent's configured reply modality (see below)
```
**Key win:** because the recording is a *complete file*, the live-voice problems noted in our
voice memory (audio cutoff, streaming-STT latency, partial-audio hallucination) **don't apply**.
It's async, so latency is a non-issue. WhatsApp voice notes are actually **more robust and
simpler** than our current real-time web voice.

**Reply modality — a per-agent decision (key product call):** when a user sends a voice note,
what does the agent reply with?

| Reply mode | Pros | Cons |
|---|---|---|
| **Text out** (default) | Cheapest, fastest, skimmable, works on mute / in public | Less "human" |
| **Voice out** (TTS) | Personal, great for low-literacy / hands-free audiences | TTS cost + latency per reply, can't skim, awkward in public |
| **Text + short voice** | Covers both | Doubles work + cost |

**Recommendation:** default to **text out** (aligns with the min-cost goal — no TTS bill across
10K orgs), and expose **voice out as an opt-in per-agent toggle** in `voiceConfig`
([schema.prisma:110-111](../../apps/api/prisma/schema.prisma#L110-L111)). Orgs that want a
voice-replying agent flip it on; everyone else stays cheap. We do **not** force voice-in →
voice-out.

**Path B — Real-time voice calls (WhatsApp Business Calling API). Newer, complex. DEFER.**
- Meta launched it **15 Jul 2025**; in 2026 it's **limited availability** (select direct Cloud
  API partners + a few enterprise BSPs like LivePerson/Infobip).
- Real-time VoIP: bridge live call audio → streaming STT → LLM → TTS → back. This *is*
  essentially our real-time voice pipeline plumbed through WhatsApp — latency-sensitive, and
  exactly where our open streaming-STT issues bite.
- **Recommendation:** not for v1. Revisit once (a) our live voice pipeline matures (streaming
  STT epic) and (b) Meta grants Calling API access.

### Other media (images, docs)
Same Media-ID download pattern. Images/docs can be passed to the agent as context (vision /
extraction) — deferred unless required for v1.

---

## 6. Schema changes

### Now (supports inbound + dormant outbound)
A new channel/routing record so the webhook resolves an agent in O(1):

```prisma
model WhatsappChannel {
  id              String    @id @default(uuid())
  agentId         String    @unique
  agent           Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  wabaId          String
  phoneNumberId   String    @unique            // ← routing key from every webhook payload
  displayPhone    String                       // human-readable, for the dashboard
  accessTokenEnc  String    @db.Text           // encrypted at rest (reuse AgentSecret crypto)
  tokenExpiresAt  DateTime?
  status          String                       // CONNECTED | PENDING | DISCONNECTED | ERROR
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([phoneNumberId])
  @@index([agentId])
  @@map("whatsapp_channels")
}
```

- `ChatSource.WHATSAPP` and `ChatSession.visitorId` — **already present**, no change.
- Encrypt the token with the same approach used for `AgentSecret` (do **not** store plaintext).

### Designed-in but dormant (outbound)
Add the *shape* now so enabling outbound later is additive, not a migration:
- A `WhatsappTemplate` model (name, language, category, status, body, `metaTemplateId`) — table
  created, **no UI / no submission logic** yet.
- Message `metadata` already JSONB — outbound delivery/read receipts slot in without DDL.

---

## 7. Outbound — what we build now vs defer

| Built now (dormant plumbing) | Deferred (turn-on work) |
|---|---|
| `WhatsappTemplate` table + enums | Template **management UI** (create/edit) |
| Channel token has send scope | **Meta template submission + approval sync** |
| Send abstraction supports template messages | Proactive **send triggers / campaigns** |
| 24h-window state is derivable from `lastMessageAt` | **Consent/opt-in** flow + suppression list |
| `metadata` holds delivery/read status | Billing-awareness UI (per-message cost) |

This matches the agreed stance: **"good to have, refine later."** Cost now ≈ a few extra
schema lines; saved later ≈ a painful migration + rework.

---

## 8. Security & reliability

- **Signature verification.** Validate `X-Hub-Signature-256` (HMAC-SHA256, app secret) on the
  **raw** body, constant-time compare. Requires NestJS `rawBody` for this route (Nest's
  `bodyParser` raw-body option, scoped to the webhook).
- **Verify-token handshake.** GET request with `hub.verify_token` → echo `hub.challenge`.
- **Idempotency.** Dedupe on WhatsApp message id (Redis SET w/ TTL) — Meta retries webhooks.
- **Token encryption** at rest; never log tokens.
- **Per-number rate limiting** via the existing `MessageRateLimitService` to cap abuse → LLM cost.
- **Queue-first** ack (<1s) so the webhook never times out under load.

---

## 9. Cost model

- **Cloud API itself:** free (Meta-hosted).
- **Inbound (customer messages first):** **free & unlimited** within the rolling 24h service
  window (since Nov 2024). For a reactive support agent, per-message cost ≈ **$0**.
- **Outbound (we initiate):** template messages only, ~$0.0094 (IN) → ~$0.12+ (DE); US
  marketing ~$0.025/msg (Jan 2026 rate card). Per-*message* since Jul 2025.
- **Direct (no BSP):** no markup on any of the above.

➡️ The MVP (inbound support on WhatsApp) is **effectively free per message**. Cost only appears
when outbound is switched on later.

---

## 10. Phased build plan

| Phase | Scope | Gates / notes |
|---|---|---|
| **0. Meta setup** | Apply as Tech Provider; Business Verification; create Meta App; app secret + webhook verify token; request `whatsapp_business_management` + `whatsapp_business_messaging` | ~2–5 days Meta review. **Start immediately — gates everything.** |
| **1. Inbound pipeline** | `WhatsappChannel` model + migration; `/public/whatsapp/webhook` (verify + signature + ACK); BullMQ queue + worker; Graph API send client; manual single-number config | Pure code, no Meta approval needed to test against our own number |
| **2. Wire the brain** | Worker → `resolveOrCreateSession(WHATSAPP)` → `DirectChatService.send()` / n8n → send reply → persist; WhatsApp threads in Conversations UI | Reuses existing core; minimal new logic |
| **3. Embedded Signup** | OAuth popup in web dashboard; code↔token exchange; register number; subscribe webhook; encrypted token store | **Multi-tenant unlock** — orgs self-onboard |
| **4. Hardening** | Idempotency, per-number rate limits, delivery/read status webhooks, observability (ties to [logger-tracer plan](./logger-tracer-plan.md)) | Scale for 10K orgs |
| **5. (Later) Outbound** | Template UI + Meta submission/approval, consent/opt-in, send triggers, billing UI | Gated by Meta template approval, not our code |

---

## 11. Prerequisites / open items for Dhruv

- [ ] Decide the **number strategy** offered to orgs: bring-their-own vs buy-new (Embedded
  Signup supports both; affects onboarding copy).
- [ ] Meta **App + Business** assets (who owns the Meta Business Portfolio for the Tech Provider app).
- [ ] Env vars: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API_VERSION`,
  `WHATSAPP_TECH_PROVIDER_*` (config IDs for Embedded Signup).
- [ ] Confirm voice-note **reply modality** default: text-out (recommended) with voice-out as a
  per-agent opt-in toggle (`voiceConfig`). WhatsApp agents run **`direct`-only** (n8n is out).

---

## 12. Appendix — Meta test setup (step-by-step, no company needed)

Gets a real WhatsApp message hitting an agent using Meta's free test number.

**A. Meta app + test number** (Meta dashboard → developers.facebook.com)
1. My Apps → Create App → use case **Other**, type **Business** (app name must NOT contain "WhatsApp").
2. Add the **WhatsApp** product → Set up. Meta creates a test number + test WABA.
3. On **WhatsApp → API Setup**, copy: **Temporary access token** (24h), **Phone number ID**, **WhatsApp Business Account ID**, and the **From** test number.
4. Under **To → Manage phone number list**, add your own phone as a test recipient (sandbox only messages listed numbers).
5. **App settings → Basic → App Secret → Show** → this is `WHATSAPP_APP_SECRET`.

**B. Server**
6. Invent a verify token: `openssl rand -hex 16`.
7. `apps/api/.env`: `WHATSAPP_APP_SECRET=<step 5>`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN=<step 6>`.
8. Apply the migration (changes the DB): from `apps/api` → `bunx prisma migrate deploy`.
9. Run the API (`localhost:3001`), then expose it: `ngrok http 3001`. Public webhook =
   `https://<ngrok-host>/api/klivo/v1/public/whatsapp/webhook`. NOTE: the dashboard form shows
   the *local* base — use the ngrok host with that path for Meta.

**C. Meta webhook** (WhatsApp → Configuration → Webhook → Edit)
10. Callback URL = the ngrok webhook URL; Verify token = same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` →
    Verify and save (hits the GET handshake).
11. Webhook fields → subscribe to **`messages`**.

**D. Connect in the dashboard**
12. Ensure the agent is **Active** with a model + system prompt configured (replies run through
    `DirectChatService.send`).
13. Agent → **WhatsApp** tab (ADMIN only) → paste Display number / Phone number ID / WABA ID /
    Access token → Connect → status flips to **Connected**.

**E. Test** — message the test number from the recipient phone; watch logs; agent replies.

**Gotchas:** verify-and-save fails → API not reachable / token mismatch. No reply → agent
inactive / no model / 24h token expired. Nothing arrives → didn't subscribe to `messages`, or
sender not in the recipient list. Webhook `401` → `WHATSAPP_APP_SECRET` mismatch. For a longer
test, use a System User token (Business Settings → System Users → generate with
`whatsapp_business_messaging` + `whatsapp_business_management`) instead of the 24h token.

## Sources

- [WhatsApp Business Platform overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform)
- [Embedded Signup overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/) · [Tech Provider onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/)
- [Become a Tech Provider (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) · [Solution Partner overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)
- [WhatsApp pricing (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [2026 pricing guide](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) · [per-message change](https://m.aisensy.com/blog/whatsapp-per-message-pricing-update-effective-january-1-2026/) · [free 24h service window](https://www.spurnow.com/en/blogs/whatsapp-business-api-pricing-explained)
- [BSP comparison 2026](https://gurusup.com/blog/whatsapp-api-bsp-providers) · [Twilio vs 360dialog](https://www.kommunicate.io/blog/twilio-vs-360dialog-a-comparison/)
- [Webhook setup (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/) · [webhook security & scaling](https://chatarmin.com/en/blog/whatsapp-webhooks) · [multi-number routing](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- [n8n WhatsApp node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.whatsapp/) · [n8n ban-risk caveats](https://aibuildr.tech/blog/how-to-use-whatsapp-business-api-free-n8n-guide/)
