# Human Handover / Live Agent Takeover — Research & Design

> Status: **Design exploration** (not yet a committed build plan). Captures how the industry
> does bot→human handover end-to-end, maps it onto our current architecture, and answers the
> open questions (storage, "client leaves", closing the chat).
> Date: 2026-06-24.

---

## 1. What this feature is (and what it's called)

This is a **solved, standard pattern**. Names used in the market: *human handover / handoff*,
*live agent takeover*, *bot-to-human escalation*, *human-in-the-loop*. Every major player
(Intercom Fin, Zendesk AI agents, Chatwoot, LiveChat, Tidio/Lyro, Freshchat, LivePerson,
Amazon Connect) implements the same conceptual model. We are not inventing anything — we are
porting a well-understood state machine onto our stack.

**Best reference for us: [Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots)**
— it's open-source (we can read the implementation), and its model maps almost 1:1 onto ours.

---

## 2. The core mental model (this dissolves most of the confusion)

Three ideas, and the whole feature falls out of them:

1. **One conversation, always persisted.** There is no separate "human conversation" store.
   It's the *same* `ChatSession`. Bot turns and human turns live in the same message list.
2. **Every message has a sender type.** Today we have `USER | ASSISTANT`. Add `HUMAN_AGENT`
   and `SYSTEM`. That's how you tell who said what.
3. **The conversation has a status state machine.** Handover is just a state transition.
   "AI won't reply" is just "the state is human-handled, so the reply pipeline skips the LLM."

Chatwoot's entire handover is literally: bot sets status `pending` → flips to `open` when a
human is needed → human picks it up → `resolved` when done → handing back to the bot is
`open`→`pending`. ([source](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots))

### Proposed state machine for us

We keep the existing `SessionStatus (ACTIVE | EXPIRED)` for the 6h-rotation/classifier
lifecycle, and add an **orthogonal** handover dimension so we don't break that logic:

```
handoverState:  NONE ──(visitor asks / frustration / bot fallback / manual)──▶ REQUESTED
                  ▲                                                                │
                  │                                          (a teammate clicks "Take over")
   ("Hand back to AI")                                                            ▼
                  └────────────────── RESOLVED ◀──("Resolve")────────────── ACTIVE_HUMAN
                                          │                                        ▲
                          (visitor sends new msg → AI resumes)        (visitor + human chat;
                                                                          AI is paused)
```

- **NONE** — bot is handling normally (today's only behaviour).
- **REQUESTED** — the flag is raised and shows on the dashboard with the "needs human" badge.
  **The bot KEEPS replying.** This is done with **one injected system-prompt line** (e.g. *"The
  user asked for a human; one is being connected. Keep helping where you can, tell them a human
  will join shortly, never claim to be human."*) — the LLM generates the "please hold, meanwhile
  how can I help?" wording itself. **No scripts, no timer, no agentic flow.**
- **ACTIVE_HUMAN** — a client-side user has clicked "Take over". **AI is paused.** Human ↔ visitor chat.
- **(end)** — human clicks **"Resolve"** → back to `NONE` (bot resumes if the visitor writes again),
  and we stamp `handoverResolvedAt` + `handoverResolvedByUserId` + a "Resolved by <name>" system line.
  That stamp is also the analytics (count of human-resolved chats = a query). If no human ever comes,
  the bot just keeps stalling and the session **expires on its own after 6h** like every session today.
  *No auto-resolve cron, no timeout, no email fallback, no "closed chat" state — all cut by scope.*
  See §9 for the liveness/expiry/resolution detail.

**AI is paused ONLY in `ACTIVE_HUMAN`.** In `REQUESTED` the bot keeps talking. This is what makes
handover feel seamless and adds zero latency to the reply path (see §3a latency rule).

**Explicitly out of scope (2026-06-24):** presence/online tracking, role gating (any bot owner can
take over), auto-resolve timers, the 10-min email-collection fallback. Niche feature — kept minimal
on purpose. *(Email fallback, if ever wanted, is just the existing `CollectedData` capture — not new
agentic work.)*

---

## 3. How the big players do it, end-to-end

### a) Trigger — how the flag gets raised

| Trigger | Used by | Notes |
|---|---|---|
| Explicit "Talk to a human" button / typed "agent","human","representative" | everyone | Most reliable. Cheapest. |
| Bot low-confidence / "not understood" / unsupported intent | Landbot, Chatlayer, Sendbird | We have a proxy already: `couldntAnswer` metric. |
| Sentiment / frustration detection | Intercom, LivePerson, Kommunicate | Needs a **real-time** signal (LLM/sentiment call per turn). |
| Repeated same question / no progress | LivePerson | Heuristic on recent turns. |
| Agent availability / business hours gate | all live-chat tools | If no human online → don't offer it; collect email instead. |

On handoff, the agent is handed **full history + intent + sentiment + collected data** so the
visitor never repeats themselves. ([Kommunicate](https://www.kommunicate.io/blog/chatbot-human-handoff/))

**Latency rule (decided 2026-06-24): detection NEVER sits in the reply critical path.**
When a visitor message arrives:
1. **Explicit "need a human"** → inline **keyword/regex** scan ("talk to a human", "speak to
   someone", "agent", "representative"…). Zero LLM, sub-millisecond, runs while we kick off the reply.
2. **Reply generation proceeds exactly as today** — tokens stream immediately, nothing waits.
3. **Sentiment/frustration** → **fire-and-forget async** check (cheap `gpt-4o-mini`) running
   *in parallel* with the reply. The reply is already out by the time it finishes; if it flags,
   we raise the flag for the dashboard + next turn.

Net latency added to a reply ≈ **0 ms**. Because the bot keeps replying in `REQUESTED`, there is
no "let me check… pause… reply" stall — the bot answers normally and the flag lights up in the
background. (Cheaper alt: have the reply LLM emit `needs_human` in the *same* call via structured
output — zero extra cost — but it complicates the streaming parse, so start with the async check.)

### b) Notify — how the human finds out

- A **"needs attention" inbox/queue** with a flag/badge on the conversation (the flag you described).
- Real-time push to the dashboard (WebSocket/SSE) so it appears without refresh; sound + browser
  notification; and **email/Slack** when nobody is looking at the screen.
- **Assignment**: auto (round-robin / load / skill-based routing) or manual "claim".

### c) Takeover — the human side

- "Join" / "Take over" button → assigns the conversation to that user.
- Bot is **paused** for that conversation; unpaused only when handed back. ([moin.ai](https://www.moin.ai/en/chatbot-wiki/human-takeover-the-chatbot-human-handover))
- Agent gets: full transcript, customer context panel, canned responses, **private notes**
  (internal, not shown to visitor), typing indicators.

### d) Visitor side

- Same chat window — no new widget. A system line: *"You're now connected to <name>."*
- Typing indicators; messages flow live both ways.

### e) Resolve / return / "done"

- Agent clicks **Resolve** (→ done, optional CSAT survey) or **Hand back to bot**.
- **Auto-resolve after inactivity** is universal (Zendesk, LiveChat, Amazon Connect, Salesforce):
  if no message for N minutes, the system resolves/closes the session automatically.
  ([Zendesk](https://support.zendesk.com/hc/en-us/articles/4408836091034-When-do-chats-time-out))
- A **resolved chat silently reopens** when the visitor sends another message. Nobody hard-blocks
  the visitor from typing.

### f) Edge cases — "the client/agent is gone"

- **Agent disconnects mid-chat**: presence/heartbeat detects it → **re-queue** (back to REQUESTED
  so another teammate grabs it) or transfer to another available agent. LiveChat/ServiceNow use
  inactivity timeouts with "reassignable" so the chat loops back into the queue.
  ([LiveChat](https://www.livechat.com/help/inactivity-how-it-works/))
- **No agent available at all**: don't offer "talk to human", or collect email and create an
  async ticket ("we'll get back to you"). Amazon Connect models this as a disconnect flow with a
  *Wait* block: "Customer return" vs "Timeout" branches.
  ([AWS](https://docs.aws.amazon.com/connect/latest/adminguide/setup-chat-timeouts.html))
- **Visitor leaves**: their messages just stop → auto-resolve after inactivity → reopen on return.

---

## 4. Direct answers to the open questions

**Q: How do we store this client-based conversation?**
Same `ChatSession`. Add `HUMAN_AGENT`/`SYSTEM` to `MessageRole`, plus handover fields on
`ChatSession` (`handoverState`, `handoverReason`, `assignedToUserId`, timestamps). No new store,
no fork. The human's messages are just `ChatMessage` rows with `role = HUMAN_AGENT`.

**Q: What happens if the client (the human agent) is gone?**
Nothing special — by deliberate scope choice. We don't track presence. When a human is requested,
the bot keeps stalling politely (prompt-injection, §2) until *someone* on the client side notices
the flag and takes over. If nobody ever does, the bot stays a helpful bot and the session expires
on its own after 6h (existing behaviour). No re-queue, no timeout, no email fallback. This is a
niche feature; we intentionally keep it dumb-simple.

**Q: Do we close the chat? Can the user message after that? (we have no "close" feature)**
You **don't need a hard close** to ship this. "Resolve" just flips `handoverState` back to `NONE`
(and stamps who/when — see §9); it is not a blocking state. The visitor is *never* prevented from
typing — a new message after resolution simply routes back to the bot (or re-raises the flag). So:
- No "close chat" feature required.
- "User can't message after that" → false; they can always message; it just goes back to the AI.

---

## 5. Where we are today (gap analysis)

| Capability | Today | Gap |
|---|---|---|
| Conversation/message storage | ✅ `ChatSession` + `ChatMessage` | — |
| Sender types | ⚠️ `USER \| ASSISTANT` only | add `HUMAN_AGENT`, `SYSTEM` |
| Conversation status | ⚠️ `ACTIVE \| EXPIRED` | add orthogonal `handoverState` |
| AI reply pipeline | ✅ `DirectChatService.stream()` | **always replies** — needs a pause check |
| Human reply endpoint | ❌ | new `POST /conversations/:id/messages` (auth) |
| Trigger signals | ⚠️ `couldntAnswer` exists; classifier is **post-session/batch** (6h), so useless for *live* triggering | add explicit button + keyword check in request path |
| Dashboard live view | ❌ historical transcripts only, **React-Query polling** | add "Live/Inbox" view + flag badge |
| Widget receive of human msgs | ❌ widget only gets AI via its own POST's SSE response | needs a receive channel while escalated |
| Widget session persistence | in-memory only, reset on reload (a deliberate rule) | **keep as-is** — do NOT persist; reload = new session by design |
| Presence / online status | ❌ none | **not needed — cut from scope** |
| Notifications | ❌ none | phase 2 only |
| Org/user model | ✅ Org → Users → Agents(bots) → Sessions | human agent = any `User` who owns the bot (no role gating) |

**Two findings worth flagging loudly:**
1. **The classifier cannot drive live handover.** It runs *after* the session ends (6h batch),
   detecting category/language only — no sentiment, no "wants human". Real-time triggering must be
   explicit-button + keyword + `couldntAnswer` streak. A real-time sentiment LLM call is a paid upgrade.
2. **The widget resets its session on reload — and that's a deliberate rule we keep.** We do NOT
   persist `sessionId`. Handover works within a page view (the in-memory session is alive while the
   visitor is on the page); the widget only needs to *receive* the human's replies during that
   window (realtime subscription). If a visitor reloads mid-handover, they start a fresh bot
   session as usual and the teammate just Resolves the abandoned one — acceptable for a niche feature.

---

## 6. The genuinely hard part: real-time transport

Two new real-time needs:
- **Dashboard ← server**: show new visitor messages + the "needs human" flag live.
- **Widget ← server**: deliver the *human's* messages (today the widget only receives AI replies
  as the SSE body of its own POST; when a human types, there's no open channel to the widget).

**Decision (2026-06-24): real WebSockets via Supabase Realtime from day one — not polling.**
This is a real product, so we do real-time properly. Options weighed against our constraints
(low cost, open-source, scale 10K orgs, **actively reducing Redis**, already on Supabase + SSE):

| Option | Fit | Verdict |
|---|---|---|
| **Supabase Realtime** (IS WebSockets — managed) | client opens a real WS to Supabase; built-in presence + broadcast + Postgres-change streams; no WS server, **no Redis backplane** | ✅ **Chosen.** Real-time done right, matches our stack |
| Self-hosted Socket.io / WS gateway | full control, but cross-instance broadcast needs a **Redis adapter** → re-introduces the heavy Redis pub/sub we just removed; we own sticky sessions, presence, scaling | ❌ against our "reduce Redis" direction + ops cost |
| Poll while escalated | cheap, no infra | ⛔ rejected — beneath a serious live-chat product |
| Long-lived SSE listen stream | server→client only; one held connection per open chat | ⚠️ keep SSE for AI token streaming, not for the bidirectional human layer |

**Two rules that keep WebSockets cheap at 10K-org scale:**
1. **Keep SSE for AI token streaming** (perfect for unidirectional token streams — don't rip it
   out). Use **Supabase Realtime only for the live human layer + presence.** They coexist.
2. **The widget subscribes to Realtime ONLY while a conversation is in handover**
   (`REQUESTED`/`ACTIVE_HUMAN`), never for idle bot chats. So concurrent WS connections ≈ number
   of *actually-escalated* chats (small), not number of visitors (huge). Dashboard subscribes per
   online teammate (few). Humans handle only a few chats at once, so concurrent human-handled
   conversations stay tiny even at 10K orgs.

---

## 7. Phased plan (real-time done right from day one)

### Phase 1 — minimal live handover (the whole feature)
- **Agent editor — two toggles** (per-bot config): (a) **"Enable human takeover"** master switch;
  (b) below it, **"Show 'Talk to a human' button in widget"** (optional; only meaningful when (a) is on).
- **Schema**: `MessageRole += HUMAN_AGENT, SYSTEM`; `ChatSession += handoverState, handoverReason,
  takenOverByUserId, handoverRequestedAt, handoverStartedAt, handoverResolvedAt, handoverResolvedByUserId`.
  Agent config gets the two toggle flags. (`couldntAnswer` already exists for the streak trigger.)
- **Trigger** (only when takeover enabled): inline keyword/regex "need a human" check (zero-latency)
  + the widget button if its toggle is on → set `REQUESTED`. (Async sentiment detection is an easy
  optional add — off critical path — but not required for Phase 1.)
- **Bot in `REQUESTED`**: keeps replying via a one-line injected prompt hint (§2). AI **not** paused.
- **AI pause**: in `PublicChatController.send()` and `.stream()`, if `handoverState === ACTIVE_HUMAN`
  → persist the user message, skip `DirectChatService`, publish it to the agent via Realtime.
- **Takeover / messaging**: `POST /conversations/:id/takeover`, `POST /conversations/:id/messages`,
  `POST /conversations/:id/handback` (authenticated; **any client-side user who owns the bot** — no
  role gating, the client side has no roles).
- **Transport**: **Supabase Realtime** for the live human layer; **SSE stays** for AI token streaming.
  Widget opens its Realtime subscription only when escalated.
- **Dashboard**: "Live / Needs attention" view + flag badge (Realtime-pushed); transcript +
  composer; Take over / Return-to-AI.
- **Widget**: NO session persistence (reload = new session, by rule). While escalated, subscribe
  to the session's Realtime channel to receive the human's replies; show "you're chatting with <name>".
- **No cron, no presence, no auto-resolve** — out of scope by decision; existing 6h EXPIRED cleans up.

### Phase 2 — only if the feature proves wanted
- Async sentiment auto-escalation; presence (online/away); assignment/routing; notifications
  (email/Slack/web-push); CSAT; canned responses; private notes; typing indicators; email/phone
  fallback (reuses existing `CollectedData`); extend to WHATSAPP source.

---

## 8. Decisions log

**Decided 2026-06-24:**
1. **Who can take over** → **any client-side user who owns the bot.** No role gating (client side
   has no roles/permissions today).
2. **Triggers** → inline keyword "need a human" (zero-latency) + an optional widget "Talk to a
   human" button. Async sentiment = easy optional add, not required for Phase 1.
3. **Agent editor** → two toggles per bot: "Enable human takeover", and below it "Show 'Talk to a
   human' button in widget" (optional).
4. **No presence tracking** → not built. Flag shows on dashboard; whoever's looking takes over.
5. **No auto-resolve / no timeout / no email fallback** → cut. Bot keeps stalling (one injected
   prompt line) until a human takes over; otherwise the session expires after 6h like today.
6. **Transport** → **Supabase Realtime (managed WebSockets)** for the live layer; **SSE retained**
   for AI token streaming. Not polling.
7. **AI pause** → only in `ACTIVE_HUMAN`; bot keeps replying in `REQUESTED`.
8. **Widget session persistence** → NONE. Reload = new session is a deliberate existing rule; we
   keep it. Widget only subscribes to the session Realtime channel while escalated to receive the
   human's replies. Reload mid-handover → fresh bot session; teammate Resolves the abandoned one.
9. **Resolution = one human "Resolve" button** → flips `handoverState` to `NONE` + stamps
   `handoverResolvedAt` / `handoverResolvedByUserId`. That stamp gives "human-resolved count" for free.
   **Bot self-resolution / CSAT is OUT of scope** — it lives in the analytics roadmap's deferred
   "resolution" item, not here.
10. **Mid-handover expiry guard** → never rotate/expire while `handoverState ≠ NONE` (see §9).
11. **Auto-trigger safety net** → a `couldntAnswer` streak (N failed bot replies) raises the flag even
    with no keyword/button — covers a silently-failing bot.

**Still open:** nothing blocking. (If the feature proves popular, revisit Phase 2 items.)

---

## 9. Liveness, expiry, and resolution (clarified 2026-06-24)

**`ACTIVE` ≠ "live".** `SessionStatus.ACTIVE` only means *"within its lifetime cap, not yet sealed"* —
a 4-hour-old abandoned chat is still `ACTIVE`. Two things flip a session to `EXPIRED`, **both gated on
age since `createdAt` > `sessionLifetimeHours` (6–24h, per agent), never on a fixed/nightly schedule**:
- lazy rotation on the next inbound message — [chat.service.ts:100-113](../../apps/api/src/services/chat.service.ts#L100-L113), and
- the classifier cron as a backstop for chats the visitor abandoned — [conversation-classifier.service.ts:167-180](../../apps/api/src/services/conversation-classifier.service.ts#L167-L180).

**What "live" really is:** recency of `lastMessageAt` (e.g. `ACTIVE AND lastMessageAt > now − 3 min`).
The Inbox's core tabs **don't need it** — they're driven by `handoverState` (`REQUESTED` / `ACTIVE_HUMAN`).
A flag is a flag whether or not the visitor has typed recently. Only the optional **"All live"** monitor
tab needs the recency definition — which is why it's Phase 2.

**Detection-gap safety nets** (covers "the bot/our logic didn't realise a human was needed"):
1. explicit keyword check, 2. optional widget button, 3. **`couldntAnswer` streak** — N failed bot
replies auto-raise the flag with no keyword/button, 4. optional async sentiment. Never 100%, but #3
specifically catches a silently-failing bot.

**Mid-handover expiry guard.** Never rotate/expire a session while `handoverState ∈ {REQUESTED,
ACTIVE_HUMAN}`, or a long human chat crossing the 6h cap would split into two sessions. One-line guard
in `resolveOrCreateSession`:
```
const isExpired = pastLifetime && existing.handoverState === 'NONE';
```
…plus exclude `handoverState != 'NONE'` from the classifier cron's candidate query. The moment it's
resolved (→ `NONE`), normal expiry resumes on the next message past the cap.

**Resolution = one human button.** When done, the human clicks **Resolve** → `handoverState = NONE`
(bot resumes if the visitor writes again — no "closed chat" state needed), and we stamp
`handoverResolvedAt` + `handoverResolvedByUserId` + a "Resolved by <name>" system line. "How many chats
humans resolved" is then just a query. No blocking close; the visitor can always message again.

**Out of scope — bot self-resolution / CSAT** ("bot asks *did that solve it?*, detect a yes → mark
bot-resolved"): a real, known pattern but a *separate* feature with its own UX cost (don't nag every
user), and it measures *all* outcomes, not just handover. It belongs to the **analytics roadmap's
deferred "resolution" item**, not this feature. Not built here.
