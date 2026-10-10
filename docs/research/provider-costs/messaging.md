# Per-event cost of non-AI third-party services (Klivo usage-cost ledger)

Retrieved: 2026-10-10 (all web sources below were fetched on this date).
Scope: Meta WhatsApp Cloud API, Resend, Clerk, Supabase Storage, Upstash Redis. LLM/STT/TTS are out of scope.
Rule: every price or rule has a source URL. Anything not confirmed from a primary source is marked **UNCONFIRMED**.

---

## 0. Headline findings

1. **WhatsApp service replies are no longer unconditionally free.** As of 1 Oct 2026, Meta charges service (non-template) messages after a free tier of **1,000 delivered service messages per business phone number per month**. India service rate on the 1 Oct 2026 card: **INR 0.115 / USD 0.0014 per delivered message**. Source: https://developers.facebook.com/docs/whatsapp/pricing (section "Free tier of monthly service messages"); INR and USD rate cards linked from that page (sheet title "Cost per message in INR on the WhatsApp Business Platform, effective October 1, 2026").
2. **Under our current Tech Provider model, the customer's own WABA pays Meta, not Klivo.** See `docs/plans/whatsapp-integration-plan.md:50` ("customer pays Meta via their own WABA payment method"). Meta confirms charges go to the Messaging account that sent each message: https://developers.facebook.com/docs/whatsapp/pricing (section "Billing attribution with multiple Messaging accounts"). So WhatsApp cost is a **pass-through to show the customer**, not Klivo COGS, until we become a Solution Partner.
3. **The exact billable signal exists, but we drop it.** Meta sends a `pricing` object (`billable`, `pricing_model`, `type`, `category`, optional `subtype`) on status webhooks. Our webhook controller ignores `statuses` entirely (`apps/api/src/modules/whatsapp/whatsapp-webhook.controller.ts:191` skips any change without `value.messages`).
4. **Resend is per recipient**, not per API call. Our handover notification sends one call to N teammates, which is N billable emails.
5. **Clerk, Supabase, Upstash are plan/fixed-dominated at our scale.** Treat as platform overhead; allocate later. Only Resend and WhatsApp warrant per-event metering.

---

## 1. Repo inventory: outbound non-AI third-party calls

All paths are under `apps/api/src/`.

### 1.1 Meta WhatsApp Cloud API (`graph.facebook.com/v21.0`)

Client: `modules/whatsapp/whatsapp-send.service.ts`. Token is per channel (`WhatsappChannel.accessTokenEnc`), so each call runs against the **customer's WABA**.

| Call                                       | Graph endpoint                                                            | What we send                                                       | Billable at Meta?                                                                                                                  | Org identifier available at call site                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `sendText` (bot reply)                     | `POST /{phoneNumberId}/messages`, `type: text`                            | Free-form reply inside the 24h customer service window             | Yes, as a **service** message (free inside the monthly 1,000 tier, then charged)                                                   | `phoneNumberId` -> `WhatsappChannel.agentId` -> `Agent.organizationId`. Caller `whatsapp-inbound.service.ts` has `agent.organizationId`. |
| `sendText` (fallback / "can't transcribe") | same                                                                      | Canned text (`FALLBACK_REPLY`, `CANT_TRANSCRIBE_REPLY`)            | Yes, service                                                                                                                       | same (`whatsapp-inbound.service.ts:140,149,259`)                                                                                         |
| `sendText` (human handover reply)          | same                                                                      | Teammate's reply from dashboard                                    | Yes, service                                                                                                                       | `whatsapp-outbound.service.ts:51`, only has `agentId`; wamid is **discarded**                                                            |
| `uploadMedia`                              | `POST /{phoneNumberId}/media` (multipart)                                 | TTS audio for a voice-note reply                                   | Not a message. No charge listed (**UNCONFIRMED**: Meta pricing doc only prices delivered messages and never lists media API calls) | `phoneNumberId`                                                                                                                          |
| `sendAudio`                                | `POST /{phoneNumberId}/messages`, `type: audio`                           | Voice-note reply (media id from upload)                            | Yes, one **service** message                                                                                                       | `phoneNumberId`; caller has `agent.organizationId` (`whatsapp-inbound.service.ts:287-297`)                                               |
| `downloadMedia`                            | `GET /{mediaId}` then `GET <lookaside url>`                               | Fetch inbound voice note bytes                                     | Inbound messages are free (see 2.1). Media download call not priced (**UNCONFIRMED**, same reason)                                 | `mediaId` only; caller has channel + agent                                                                                               |
| `markReadAndShowTyping`                    | `POST /{phoneNumberId}/messages` with `status: read` + `typing_indicator` | Read receipt + typing indicator                                    | Not a message to the user, so no category applies (**UNCONFIRMED**, no explicit primary statement found)                           | `phoneNumberId`                                                                                                                          |
| `verifyPhoneNumberOwnership`               | `GET /{phoneNumberId}`                                                    | Ownership check on connect (`whatsapp-channel.service.ts:188-242`) | No (management call)                                                                                                               | dto + agent                                                                                                                              |

**Template messages: we send none today.** No `type: "template"` call exists in the module. Outbound templates are a later phase (`docs/plans/whatsapp-integration-plan.md:292`). Consequence: human handover replies sent more than 24h after the visitor's last message will be rejected by Meta (non-template outside the window); that is a delivery issue, not a cost.

Gaps for a cost ledger:

- `providerLog.traced(...)` in `whatsapp-send.service.ts` never passes `organizationId` / `agentId`, though `common/events/traced-call.ts:9-11` supports both.
- Status webhooks (with `pricing`) are not parsed. Bot replies keep the wamid (`outboundId`, `whatsapp-inbound.service.ts:276-320`); human replies drop it.

### 1.2 Resend email

Client: `services/email.service.ts:37-99` (`resend.emails.send`, one call, `to: recipients[]`, tag `type`). It takes **no `organizationId`**.

| Email                                                            | Caller                                                                                                         | Recipients per call                                                     | Org known at caller?         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| `TEAM_INVITATION`                                                | `services/invitations.service.ts:452`                                                                          | 1                                                                       | Yes (invitation's org)       |
| `HANDOVER_REQUESTED` (and any notification with `email.enabled`) | `services/handover.service.ts:302` -> `notification.service.ts:114` -> `notification-mailer.service.ts:66-104` | N: explicit list, or **every member of the org** when the list is empty | Yes (`input.organizationId`) |

Billing implication: each recipient counts as one email (see 2.2). The comment in `email.service.ts:29` ("one provider call instead of N") saves API calls, not quota.

### 1.3 Clerk

Client: `services/clerk-management.service.ts`.

- `invitations.createInvitation` with `notify: false` (we send our own email), called from `invitations.service.ts:381`.
- `invitations.revokeInvitation`.
- `users.getUser` (email-verified check) from `users.service.ts:261`.
- JWT verification via JWKS (no per-call charge).
  Clerk **Organizations are not used**: orgs are our own Postgres model. So Clerk MRO (organization) pricing does not apply. Only dashboard users are Clerk users; widget visitors and WhatsApp users are not.

### 1.4 Supabase Storage

Client: `services/supabase-storage.service.ts` (`upload`, `remove`, `getPublicUrl`). Callers: `services/files.service.ts:146,214,245`, `services/purge.service.ts:484`. Storage key is `${organizationId}/${agentId}/${purpose}/...` (`files.service.ts:143`), and the `File` table stores `sizeBytes` and `organizationId` (`prisma/schema.prisma` ~line 767-780). Bucket `agent_assets` is public, so widget loads of avatars/assets create egress.

### 1.5 Redis (Upstash, per task brief; code is provider-agnostic `REDIS_URL`)

`common/redis/redis.service.ts` (ioredis): agent config cache (`common/cache/agent-cache.service.ts`), rate limiter (`common/redis/rate-limiter.service.ts`, pipeline), Socket.io pub/sub adapter (`common/ws/redis-io.adapter.ts`, enabled by `SOCKET_IO_REDIS`), health `PING`. Keys are not consistently org-scoped, and pub/sub traffic is shared.

---

## 2. Pricing from primary sources

### 2.1 Meta WhatsApp Business Platform

Primary sources:

- P1 Pricing page: https://developers.facebook.com/docs/whatsapp/pricing (canonical path also served at https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing). Page header: "This page reflects pricing updates that became effective as of October 1, 2026".
- P2 INR list rates (xlsx served as .csv, linked from P1 "INR list rates"), sheet title "Cost per message in INR on the WhatsApp Business Platform, effective October 1, 2026". Direct link is a signed fbcdn URL that expires; open it from P1's rate-card table.
- P3 USD list rates (same, "USD list rates"), "effective October 1, 2026".
- P4 Status webhook reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/
- P5 Analytics (pricing_analytics): https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
- P6 AI Providers policy: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers/
- P7 Marketing page: https://whatsappbusiness.com/products/platform-pricing/ (redirect target of business.whatsapp.com/products/platform-pricing)

**Model**

- Per-message pricing since 1 July 2025; conversation-based pricing is deprecated. (P1)
- Charged only when a message is **delivered**. (P1: "Businesses are only charged when a message is delivered")
- Rate depends on (a) message category and (b) recipient country calling code. (P1)
- Five categories since 1 July 2026: marketing, utility, authentication, service, Meta Business Agent. One message = one category = at most one charge. (P1)
- Template messages: marketing, utility, authentication. Non-template messages (`text`, `image`, `audio`, ...) are **service**, allowed only inside an open customer service window (CSW, 24h from the user's last message). (P1)
- Meta Business Agent category is Meta's own AI responder, priced per token (rate card column "Meta Business Agent": "$2.00 USD / 1 M (million) tokens"). We do not use it. (P1, P2)

**What is free**

- Messages from a WhatsApp user to the business (inbound): not charged. (P1, "When Meta does not charge": "Meta does not charge for messages from a WhatsApp user to a business")
- Free entry point (FEP) window: all business messages are free while open. Opens when a user arrives via a Click-to-WhatsApp ad or Facebook Page CTA on the Android/iOS app and the business replies within the CSW; may stay open up to 7 days. (P1 "Free entry point window (FEP)"). Klivo does not run CTWA ads, so expect ~0 FEP traffic.
- **Service messages: first 1,000 delivered per business phone number per calendar month** (resets 12am in the Messaging account timezone, no roll-over); charged from the 1,001st, effective 1 Oct 2026. (P1 "Free tier of monthly service messages"). Through 30 Sep 2026 service messages were fully free.
- Utility templates sent inside an open CSW are free (P1 overview; P7: "we do not charge for service messages, or for utility messages businesses send in response to users"). Note P7 marketing copy predates or ignores the 1 Oct 2026 service free-tier change; P1 is authoritative.
- Government / non-profit exemption: service messages beyond the free tier stay free for eligible orgs through 31 Dec 2027; marked by `pricing.subtype: "paid_exempt"` from 12 Oct 2026. (P1 "Service - Pricing policy for eligible governments and non-profits")
- Media upload/download and read/typing calls: no charge stated anywhere in P1. **UNCONFIRMED** (absence of a price, not an explicit "free" statement).

**Volume tiers**: only utility and authentication; aggregated per business portfolio, per market-category, monthly reset; only charged messages count. Service and marketing have no tiers. (P1 "Volume tiers for utility and authentication messages")

**India rates, effective 1 Oct 2026** (P2 INR row "India", P3 USD row "India")

| Category                                 | INR / delivered msg | USD / delivered msg |
| ---------------------------------------- | ------------------- | ------------------- |
| Marketing                                | 0.8631              | 0.0118              |
| Utility (list rate, before tiers)        | 0.1150              | 0.0014              |
| Authentication (list rate, before tiers) | 0.1150              | 0.0014              |
| Authentication-international             | 2.4971              | 0.0304              |
| **Service (after free 1,000)**           | **0.1150**          | **0.0014**          |

Currency: India Sold-To customers got INR billing on 1 Jan 2026 and must migrate all WABAs to INR by 31 Dec 2026, or non-INR WABA messages stop delivering on 1 Jan 2027. A WABA's currency is fixed at creation. (P1 "Currencies" and India billing note.) So the ledger must store rates per currency and use the customer WABA's currency.

Rates can change only on 1 Jan / 1 Apr / 1 Jul / 1 Oct, with at least 1 month notice for rate changes. (P1 "Pricing calendar"). Version the rate table by `effective_from`.

**AI Providers policy (P6)**: Meta charges "AI Providers" (as defined in WhatsApp ToS) for non-template messages, category `general_purpose_ai`, but only to users in listed markets (EU/EEA countries, Norway, Iceland, Liechtenstein; India is **not** listed). Whether Klivo's customers count as "AI Providers" is **UNCONFIRMED** (P6 defers to the ToS; business customer-service bots appear to be outside it). For India-only traffic it has no effect either way.

**Billable signal in webhooks (P4, P1 "Pricing webhooks")**

```json
"pricing": {
  "billable": true,              // true = charged
  "pricing_model": "PMP",        // PMP = per-message pricing (CBP = legacy)
  "type": "regular",             // regular | free_customer_service | free_entry_point | free_group_customer_service
  "category": "service",         // authentication | authentication-international | group_marketing | group_service | group_utility | marketing | marketing_lite | referral_conversion | service | utility
  "subtype": "paid_exempt"       // only for exempt gov/non-profit service messages
}
```

- Present on the `sent` status and on one of `delivered` or `read` (P4: "only included with sent status, and one of either delivered or read status"). A `read` may arrive without `delivered` (P4).
- Service message inside free tier: `billable:false, type:"free_customer_service", category:"service"`. After the 1,000th: `billable:true, type:"regular", category:"service"`. (P1)
- Tier information is **not** in webhooks; use pricing_analytics. (P1 "Pricing webhooks": "currently, tiering information is not included in any webhooks")

**Per-message formula**

```
cost(msg) = 0                                         if status never reached delivered/read (failed)
          = 0                                         if pricing.billable == false
          = rate[currency][country(recipient)][pricing.category] (at effective date, tier-adjusted for utility/auth)
                                                      if pricing.billable == true
```

Trust `pricing.billable` per wamid rather than recomputing the 1,000 free-tier counter ourselves; Meta decides which message is the 1,001st (per phone number, Messaging-account timezone). Use our own counter only as an estimate before the webhook arrives.

**Worked example, India, October 2026, one org with one WhatsApp number (INR WABA)**

- 2,800 bot text replies + 300 voice-note replies (each = 1 audio message) + 200 human handover replies = 3,300 delivered service messages.
- 50 fallback/"can't transcribe" texts = 50 more service messages. Total service = 3,350.
- Free tier: first 1,000. Billable: 2,350 x INR 0.115 = **INR 270.25** (USD: 2,350 x 0.0014 = USD 3.29).
- Inbound messages (any count), voice-note downloads, read/typing indicators: INR 0 (inbound confirmed free; the rest **UNCONFIRMED** but unpriced).
- If the org later sends 1,000 marketing templates: 1,000 x 0.8631 = INR 863.10. 500 utility templates outside the CSW: 500 x 0.115 = INR 57.50 (minus tier discounts if reached).
- Marginal cost per extra bot reply in this org this month: INR 0.115. Average cost per reply: 270.25 / 3,350 = INR 0.081.
- Who pays: the customer's WABA (Tech Provider model). Klivo's cost = 0 unless we move to Solution Partner / shared credit line.

### 2.2 Resend

Source: https://resend.com/pricing (Transactional plans and FAQ).

| Plan  | Price/month                              | Emails/month                          | Daily limit | Overage per 1,000                             |
| ----- | ---------------------------------------- | ------------------------------------- | ----------- | --------------------------------------------- |
| Free  | $0                                       | 3,000                                 | 100/day     | not offered                                   |
| Pro   | $20                                      | 50,000                                | none        | $0.90                                         |
| Pro   | $35                                      | 100,000                               | none        | $0.90                                         |
| Scale | $90 / $160 / $350 / $650 / $825 / $1,150 | 100k / 200k / 500k / 1M / 1.5M / 2.5M | none        | $0.90 / $0.80 / $0.70 / $0.65 / $0.52 / $0.46 |

- Counting: "Every recipient of an /emails API send counts as one email against your transactional quota." (https://resend.com/pricing FAQ). Received (inbound) emails also count (same FAQ; and https://resend.com/docs/api-reference/rate-limit: "Both sent and received emails count towards these quotas").
- Overage must be enabled ("Transactional Overages" in team settings) and is billed in 1,000-email buckets. (https://resend.com/pricing)
- Cost is a **plan tier with per-1,000 overage**, so the true marginal cost of one email is $0 inside the plan and $0.0009 (Pro) in overage.
- Ledger unit: `recipients.length` per send, attributed to `organizationId`. Price for attribution at the plan's effective rate (e.g. Pro $20/50,000 = $0.0004/email) or at overage ($0.0009/email). Recommendation: store count, apply the rate at report time.

### 2.3 Clerk

Source: https://clerk.com/pricing

- Billing unit: **Monthly Retained User (MRU)**: a user who visits at least one day after sign-up in the month; sign-up day is free. 50,000 MRU included per app on Hobby (free), Pro ($25/mo, $20 annual), Business ($300/mo, $250 annual). Beyond: $0.02/MRU (50,001-100,000), tiered down to $0.012.
- Organizations (MRO): 100 included, $1 per extra MRO. **Not applicable**: we do not use Clerk Organizations (1.3).
- Invitations and invitation emails: included, no separate charge. SMS: $0.01/SMS US/CA on Pro+ (we do not use SMS codes; **UNCONFIRMED** that no SMS factor is enabled in the Clerk dashboard).
- Per-org attribution: only dashboard users are MRUs. Klivo will sit far under 50,000, so marginal cost per user is $0. Treat as **fixed overhead** (plan fee). If ever needed, allocate by count of active org members from our DB.

### 2.4 Supabase (Storage)

Source: https://supabase.com/pricing (Pro column) and https://supabase.com/docs/guides/platform/manage-your-usage/storage-size

- Pro: from $25/mo with $10 compute credit; Storage 100 GB included then $0.0213 per GB; egress 250 GB then $0.09/GB; cached egress 250 GB then $0.03/GB; DB size 8 GB then $0.125/GB; image transformations 100 origin images then $5 per 1,000. Free: 1 GB storage, 5 GB egress, 500 MB DB.
- Storage is billed on average size over the billing period (GB-hours), not live size (storage-size doc, via search summary; **UNCONFIRMED** exact wording, verify on the page).
- Pro has spend caps on by default; turn off to pay overage. (https://supabase.com/pricing)
- Per-org attribution is possible for storage: `SUM(File.sizeBytes) GROUP BY organizationId`, snapshotted daily. Egress per org is not measurable without CDN logs (**UNCONFIRMED** whether Supabase exposes per-object egress).
- Current plan for Klivo: project memory says Free plan; **UNCONFIRMED**.

### 2.5 Upstash Redis

Sources: https://upstash.com/pricing/redis, https://upstash.com/docs/redis/overall/pricing

- Free: 500K commands/month, 250 MB data, 10 GB bandwidth.
- Pay-as-you-go: $0.20 per 100K commands (reads = writes); storage $0.25/GB (first 1 GB free per DB); bandwidth free to 200 GB then $0.03/GB.
- Fixed plans: 250 MB $10, 1 GB $20, 5 GB $100, ... (+per read region).
- Not charged: AUTH, HELLO, SELECT, COMMAND, CONFIG, INFO, PING, RESET, QUIT.
- Whether PUBLISH/SUBSCRIBE messages and each pipelined command count separately: **UNCONFIRMED** (not stated on either page). Socket.io adapter pub/sub may dominate command volume.
- Per-org attribution: not practical (shared cache keys, pub/sub fan-out). Treat as **fixed overhead**.

---

## 3. Recommendation: meter per event vs overhead

| Service          | Billing unit                                                                               | Meter per event?        | Ledger unit                                            | Attribution key                                         |
| ---------------- | ------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| WhatsApp         | Delivered message x category x country; 1,000 free service msgs per phone number per month | **Yes**                 | 1 row per wamid; cost from `pricing` in status webhook | `phoneNumberId` -> channel -> agent -> `organizationId` |
| Resend           | Recipient (email) against plan quota; overage per 1,000                                    | **Yes** (count)         | `recipients.length` per send                           | `organizationId` (add param to `EmailService.send`)     |
| Clerk            | MRU (50k free/app)                                                                         | No                      | n/a                                                    | Fixed overhead                                          |
| Supabase Storage | GB-month (+ egress GB)                                                                     | Snapshot, not per event | Daily `SUM(sizeBytes)` per org                         | `File.organizationId`                                   |
| Upstash          | Commands (+ storage, bandwidth)                                                            | No                      | n/a                                                    | Fixed overhead                                          |

WhatsApp-specific: tag ledger rows with `payer = CUSTOMER_WABA` while we are a Tech Provider, so the pricing model shows it as pass-through and does not add it to Klivo COGS.

Code changes the ledger will need (not done; research only):

1. Parse `value.statuses[]` in `whatsapp-webhook.controller.ts`; upsert by wamid; take `pricing` from the first status that carries it; mark `failed` as 0 cost.
2. Persist wamid for human replies (`whatsapp-outbound.service.ts` discards it).
3. Pass `organizationId`/`agentId` into `providerLog.traced` in `whatsapp-send.service.ts`.
4. Add `organizationId` to `EmailService.send` and log `recipients.length`.

---

## 4. Monthly reconciliation APIs

| Service  | API                                                                                                                       | Notes                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp | `GET /<WABA_ID>?fields=pricing_analytics.start(<unix>).end(<unix>).granularity(DAILY                                      | HALF_HOUR                                                                                                                                                                                                                                             | MONTHLY).dimensions([PHONE,PRICING_CATEGORY,PRICING_TYPE,COUNTRY,TIER]).metric_types([COST,VOLUME])` (P5 "Pricing analytics") | Filters: `phone_numbers`, `country_codes`, `pricing_types` (FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT, REGULAR), `pricing_categories` (AUTHENTICATION, AUTHENTICATION_INTERNATIONAL, MARKETING, MARKETING_LITE, SERVICE, UTILITY, REFERRAL_CONVERSION). Lookback max 1 year since 1 Dec 2025. COST is hidden for businesses billed through a Solution Partner (P5). Run with each customer's token against their WABA; that our Embedded Signup token scopes permit this is **UNCONFIRMED**. Meta notes insights are approximate (P1 "Tiering accrual"). Invoices live in Meta Billing Hub (P1 "Billing"). |
| Resend   | `GET /emails` (list sent, cursor `limit`/`after`/`before`), `x-resend-monthly-quota` response header (used monthly quota) | https://resend.com/docs/api-reference/emails/list-emails, https://resend.com/docs/api-reference/rate-limit. No dedicated billing/usage API found (**UNCONFIRMED**). Tags (`type`) allow slicing in the dashboard.                                     |
| Clerk    | None found                                                                                                                | Dashboard billing only (**UNCONFIRMED**: no public usage API located). Low value anyway.                                                                                                                                                              |
| Supabase | Dashboard org usage page; Management API `GET /v1/projects/{ref}/billing/addons` (compute/add-ons only)                   | No storage-usage endpoint confirmed (**UNCONFIRMED**). Use our `File` table or `storage.objects` metadata for per-org bytes.                                                                                                                          |
| Upstash  | `GET https://api.upstash.com/v2/redis/stats/{id}`                                                                         | Returns `total_monthly_requests`, `daily_net_commands`, `total_monthly_billing` ("Total cost in current month"), `dailybilling`, `total_monthly_bandwidth`, `current_storage`. https://upstash.com/docs/devops/developer-api/redis/get_database_stats |

---

## 5. Source list (all retrieved 2026-10-10)

- https://developers.facebook.com/docs/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
- INR and USD list-rate sheets linked from the pricing page rate-card table (signed fbcdn URLs; re-open from the pricing page)
- https://whatsappbusiness.com/products/platform-pricing/
- https://resend.com/pricing
- https://resend.com/docs/api-reference/rate-limit
- https://resend.com/docs/api-reference/emails/list-emails
- https://clerk.com/pricing
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
- https://upstash.com/pricing/redis
- https://upstash.com/docs/redis/overall/pricing
- https://upstash.com/docs/devops/developer-api/redis/get_database_stats
