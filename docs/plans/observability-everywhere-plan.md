# Observability Everywhere — Backend Logging & Event-Tracing Plan

**Status:** Approved design / ready to implement
**Scope:** `apps/api` (NestJS) only. No frontend work in v1.
**Author:** Engineering (AI-assisted)
**Supersedes:** the two-table design in [`audit-observability-plan.md`](./audit-observability-plan.md) (we keep its cross-cutting thinking — redaction, size caps, fire-and-forget, no-FK, retention — but consolidate onto **one** `EventLog` table per the locked decision below). Builds on [`logger-tracer-plan.md`](./logger-tracer-plan.md), which is **already implemented**.

> **Implementer note (read first):** This plan is written to be executed by an LLM (Sonnet) with minimal judgement calls. Every file path, code snippet, event-name string, and verification step is spelled out. Do the phases **in order**. After every phase run `bun run lint && bun run check-types && bun run build`, and if anything under `apps/api` changed, `bun run test:cov`. Do not start a phase until the previous one is green.

---

## 0. The two things we are building

The user wants **two independent tiers** of logging across the whole backend:

### Tier 1 — Console/terminal logs (cloud-visible)
Proper `console`/stdout logs at **every meaningful step, branch, and error**, formatted as:

```
[ServiceName] [functionName] - message            (corr:1a2b3c4d)
```

These print to stdout (NestJS `Logger` already does) and show up in the host's log viewer (Render/Fly/etc.). We are **not** introducing pino for app logs — we keep NestJS `Logger` and add a tiny wrapper that enforces the format.

### Tier 2 — Event logs in the DB (`event_logs` table)
A **single unified table** that records, for the **main business events** and **every third-party call**:

- **who did it** — internal `actorUserId` (dashboard) or `visitorId` (widget/whatsapp)
- **agent id**, organization id, chat session id, correlation id
- the **request** we made/received, including **custom headers only** (never `Authorization`/cookies/api-keys)
- the **response** — either the third party's response **or** our response to the frontend
- an **event name in CAPS** (`WIDGET_MESSAGE_RECEIVED`, `ELEVENLABS_STT_COMPLETED`, …)
- channel (`WIDGET`/`DASHBOARD`/`WHATSAPP`/`VOICE`/`INTERNAL`/`SYSTEM`), latency, success/error

"Widget log table" and "dashboard log table" are **views over one table** filtered by the `channel` column (`WHERE channel='WIDGET'`). One table = one migration, one set of code, easy cross-channel queries.

---

## 1. What ALREADY exists (do NOT rebuild)

The previous `logger-tracer-plan.md` was implemented. Confirmed present in the codebase:

| Capability | File | State |
|---|---|---|
| NestJS `Logger` per service (`new Logger(X.name)`) | 58 service/controller files | ✅ consistent |
| Correlation id + request context (AsyncLocalStorage) | `src/common/tracer/correlation.storage.ts` | ✅ has `correlationId, userId, clerkId, method, url` |
| Inbound request log (`→ METHOD URL [corr]`) | `src/middleware/correlation-id.middleware.ts` | ✅ |
| Outbound response log (`← METHOD URL status ms`) + enrich ctx with `userId/clerkId` | `src/interceptors/logging.interceptor.ts` | ✅ |
| Global 500 logging + Sentry | `src/filters/all-exceptions.filter.ts` | ✅ |
| `audit_logs` table + `TracerService.logAuditEvent(contextId, EVENT, data)` | `src/common/tracer/tracer.service.ts`, schema `AuditLog` | ✅ writes correlationId/userId/clerkId |
| Domain loggers (agent, user, org, invitation, email, clerk) | `src/common/logger/*.logger.ts` + `logger.module.ts` | ✅ used only by dashboard CRUD services |
| Per-turn AI step replay | `src/modules/ai/trace/ai-trace.service.ts`, schema `ChatTrace` | ✅ used by `direct-chat.service.ts` |
| Per-LLM-call usage/cost | schema `LlmUsage`, `usage-tracking.service.ts` | ✅ |
| pino (installed, used **only** by `ai-trace.logger.ts`) | `package.json` | ✅ leave as-is |

**Key consequence:** Tier-1 plumbing and the tier-2 *foundation* exist. The gaps are (a) the `[service] [function]` **format + coverage** for Tier 1, and (b) tier-2 coverage of the **channel paths** (widget/voice/whatsapp/internal) and **third-party calls**, which today are not recorded in a queryable table.

### 1.1 Relationship to `audit_logs` (existing) vs `event_logs` (new)

- `audit_logs` stays exactly as-is. The 6 domain loggers keep writing to it (dashboard CRUD lifecycle: `AGENT_UPDATED`, `INVITATION_CREATED`, …). **Do not break it.**
- `event_logs` (new) is the comprehensive table for channels + third-party calls.
- They overlap only for dashboard CRUD. We **dual-track on purpose in v1** (audit_logs = curated lifecycle; event_logs = channel/HTTP/third-party). Consolidation (re-point domain loggers at `event_logs`, deprecate `audit_logs`) is **Phase 8, optional** — not required for the deliverable.

---

## 2. Locked design decisions

1. **One unified `event_logs` table**, discriminated by `channel`. (Not separate physical tables.)
2. **Tier 1 = NestJS `Logger` + thin `AppLogger` wrapper** for `[service] [function] - message`. No pino for app logs.
3. **Phased rollout**, PR per phase (see §11).
4. **No foreign keys** on `event_logs` — `agentId`/`organizationId`/`sessionId` are nullable strings, no `@relation`. (An audit row must outlive what it references; FK checks add write contention; fire-and-forget writes must never throw on a mid-delete race. Same pattern as existing `AuditLog`, `ChatTrace`, `LlmUsage`.)
5. **Fire-and-forget writes (NON-NEGOTIABLE — see §2.1)** — every `event_logs` write is `void tracer.logEvent(...)` wrapped in try/catch; it must **never** add latency to, throw into, or break the business path.
6. **Redaction + size caps are mandatory**, applied at write time inside the tracer (see §5). Never store: `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`, `xi-api-key`, `api-subscription-key`, `proxy-authorization`, or any body field matching `/password|secret|token|apikey|api_key|authorization|credential|cookie/i`. Never store raw audio/file bytes — store metadata (bytes, mime, duration) only.
7. **Retention = keep forever in v1.** A cleanup cron is built but ships disabled (`EVENT_LOG_RETENTION_DAYS=0` = never delete). Tiering/archival is out of scope for v1.
8. **DB tier captures curated "main events" + third-party calls + an automatic HTTP envelope for mutating requests** — NOT every GET (volume). Console tier (Tier 1) is the exhaustive "every step" layer.

### 2.1 Fire-and-forget guarantee (NON-NEGOTIABLE)

> **The event-log table must NEVER break, slow, or change a service.** If logging fails, the user request must still succeed exactly as if logging didn't exist. This is the single hardest rule in this plan — every reviewer checks it.

Concrete rules every implementer MUST follow:

1. **Never `await` a log write in the request path.** Always `void tracer.logEvent(...)`. Awaiting would add the DB round-trip's latency to the user's response and surface a log-DB hiccup as a user-facing failure.
2. **`logEvent()` swallows all its own errors.** Its body is wrapped in `try/catch`; the catch only does a `this.logger.error(...)` to stdout and returns. It NEVER re-throws. A Prisma outage, a serialization error, a too-big payload — none of them propagate.
3. **`tracedCall()` re-throws the BUSINESS error, never a logging error.** This is the one subtlety: `tracedCall` wraps a third-party call so the original call behaves *identically* — if the third party throws, the caller still gets that throw (control flow unchanged). But the `logEvent` it fires is itself `void`-ed + self-swallowing, so a logging failure inside `tracedCall` can never become the thrown error. Logging success/failure is invisible to the call's outcome.
4. **No FK constraints** (decision §2.4) — so a write can't fail on a referenced-row race.
5. **Redaction/size-cap/serialize all happen inside `logEvent` in the catch-protected path** — a malformed payload degrades to `{ _truncated }`/`{ _unserializable }`, it never throws.
6. **Master kill switch:** `EVENT_LOG_ENABLED=false` makes `logEvent` a no-op immediately (checked first line). If event logging ever misbehaves in prod, flip this env var — services keep running untouched.
7. **The auto HTTP capture (§8) and exception filter (§8) writes are also `void`-ed** — capturing a request/response envelope must never delay the response or convert a handled error into an unhandled one.

If you ever find yourself writing `await tracer.logEvent(...)` or `await tracedCall(...).logEvent` in a service method, stop — that's the bug this section exists to prevent. (`await tracedCall(meta, fn)` itself IS correct — you await the *business* call; the logging inside is already fire-and-forget.)

---

## 3. Tier 1 — Console logging convention

### 3.1 The `AppLogger` wrapper (NEW)

**File:** `apps/api/src/common/logger/app-logger.ts`

```ts
import { Logger } from '@nestjs/common';
import { getRequestContext } from '../tracer/correlation.storage';
import { safeMeta } from '../events/redaction.util';

/**
 * House logger. Wraps NestJS Logger so every line reads:
 *   [ServiceName] [functionName] - message            (corr:1a2b3c4d)
 *
 * - ServiceName  = the NestJS Logger context (the [..] Nest prints).
 * - functionName = passed per call, so each line says which method emitted it.
 * - corr         = short correlation id from AsyncLocalStorage (when in a request).
 *
 * Use exactly one per class:
 *   private readonly log = new AppLogger(MyService.name);
 * Then:
 *   this.log.info('sendMessage', 'routing to direct mode', { agentId });
 *   this.log.error('sendMessage', 'llm call failed', err, { agentId });
 */
export class AppLogger {
  private readonly nest: Logger;

  constructor(service: string) {
    this.nest = new Logger(service);
  }

  private fmt(fn: string, msg: string, meta?: Record<string, unknown>): string {
    const corr = getRequestContext()?.correlationId?.slice(0, 8);
    const tail = corr ? ` (corr:${corr})` : '';
    const metaStr = meta ? ` ${safeMeta(meta)}` : '';
    return `[${fn}] - ${msg}${metaStr}${tail}`;
  }

  /** Normal step / decision / success. */
  info(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.log(this.fmt(fn, msg, meta));
  }

  /** Degraded but handled (fallback taken, retry, soft-miss). */
  warn(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.warn(this.fmt(fn, msg, meta));
  }

  /** Failure. Pass the caught error as `err` to capture its message + stack. */
  error(fn: string, msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const detail = err instanceof Error ? err.message : err != null ? String(err) : '';
    const full = detail ? `${msg} — ${detail}` : msg;
    this.nest.error(this.fmt(fn, full, meta), err instanceof Error ? err.stack : undefined);
  }

  /** Verbose tracing — entry points, payload shapes. Off in prod by default. */
  debug(fn: string, msg: string, meta?: Record<string, unknown>): void {
    this.nest.debug(this.fmt(fn, msg, meta));
  }
}
```

Rendered example (NestJS default format):
```
LOG   [ChatService] [sendMessage] - routing to direct mode {"agentId":"a1"} (corr:1a2b3c4d)
ERROR [LlmService]  [streamCompletion] - llm call failed — 429 rate limited (corr:1a2b3c4d)
```

> Format is centralized in `fmt()`. If the exact separators ever need to change (e.g. literal `[service] - [function] - message`), it's a one-line edit there.

### 3.2 Migration policy for Tier 1 (do this incrementally per phase)

In each phase's target files, **replace** `private readonly logger = new Logger(X.name);` with `private readonly log = new AppLogger(X.name);` and convert call sites:

| Old | New |
|---|---|
| `this.logger.log(\`msg\`)` | `this.log.info('fnName', 'msg')` |
| `this.logger.warn(\`msg\`)` | `this.log.warn('fnName', 'msg')` |
| `this.logger.error(\`msg: ${e}\`)` | `this.log.error('fnName', 'msg', e)` |
| `this.logger.debug(\`msg\`)` | `this.log.debug('fnName', 'msg')` |

> The `logging.interceptor.ts`, `correlation-id.middleware.ts`, and `all-exceptions.filter.ts` use `new Logger('HTTP')` with a semantic context — **leave those as plain `Logger`**; they're framework-level, not service methods. Same for `main.ts` bootstrap logger.

### 3.3 What to log in every method (the "every step / every path" rule)

Apply this checklist to **every service method** touched in a phase:

1. **Entry** (`debug`): method name + key identifiers (ids, mode, sizes). Never the full payload.
   `this.log.debug('handleInbound', 'received', { from: maskPhone(from), type });`
2. **Each decision/branch** (`info`): which path was taken and why.
   `this.log.info('streamMessage', 'agent in direct mode → DirectChatService');`
3. **Before/after each external boundary** (`info`): DB-heavy ops, cache hits/misses, third-party calls.
   `this.log.info('transcribe', 'STT provider selected', { provider });`
4. **Every fallback / retry / soft-miss** (`warn`): say what failed and what we did instead.
   `this.log.warn('transcribe', 'Sarvam failed, falling back to Deepgram', { err });`
5. **Every `catch`** (`error`): pass the error object so message + stack are captured.
   `} catch (err) { this.log.error('send', 'persist failed', err, { sessionId }); }`
6. **Successful completion of a unit of work** (`info`): with the outcome (id created, ms, status).

> Do **not** log secrets, full prompts, raw tokens, full message bodies, phone numbers (use `maskPhone`), or audio bytes. Keep messages one line.

---

## 4. Tier 2 — Schema (`event_logs`)

**File:** `apps/api/prisma/schema.prisma` — add two enums + one model (place near `AuditLog`).

```prisma
enum EventChannel {
  WIDGET     // public embeddable chat widget (POST /public/chat/*)
  DASHBOARD  // authenticated app APIs (agents, orgs, conversations, analytics, …)
  WHATSAPP   // WhatsApp inbound webhook + outbound Graph API
  VOICE      // public voice conversation endpoint
  INTERNAL   // cron / background jobs (classifier, data-extraction, handover sweep)
  SYSTEM     // bootstrap, health, migrations
}

enum EventDirection {
  INBOUND    // something arrived at us (a request, a channel message, a webhook)
  OUTBOUND   // a call we made out (third-party) OR our response back to the client
  INTERNAL   // an internal state-change / lifecycle event
}

/// Unified observability event log. Append-only, no FKs (see plan §2.4).
/// Holds: curated business events, the HTTP envelope of mutating requests,
/// and every third-party (LLM / STT / TTS / WhatsApp / n8n / email / clerk) call.
/// "Widget logs" / "dashboard logs" = filter by `channel`.
model EventLog {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  channel   EventChannel
  eventName String         // SCREAMING_SNAKE_CASE, e.g. WIDGET_MESSAGE_RECEIVED
  direction EventDirection @default(INTERNAL)
  provider  String?        // ANTHROPIC | OPENAI | GROQ | GEMINI | OPENROUTER | CEREBRAS |
                           // ELEVENLABS | SARVAM | DEEPGRAM | META_WHATSAPP | N8N |
                           // RESEND | CLERK | SUPABASE ; null for our own events

  // WHO
  actorUserId    String?   // internal users.id (dashboard actor); null for visitors
  clerkId        String?   // clerk sub, cross-ref
  visitorId      String?   // widget IP / whatsapp phone (mask phone before storing)

  // WHAT IT CONCERNS
  agentId        String?
  organizationId String?
  sessionId      String?   // chat session id
  correlationId  String?

  // REQUEST (what we sent / received)
  requestUrl      String?  // third-party URL or our route
  requestHeaders  Json?    // CUSTOM headers only, sanitized (never auth/cookie/api-key)
  requestPayload  Json?    // body sent/received, redacted + size-capped

  // RESPONSE (third-party response OR our response to the client)
  responseStatus  Int?
  responsePayload Json?    // redacted + size-capped

  // OUTCOME
  latencyMs    Int?
  success      Boolean @default(true)
  errorMessage String?

  metadata Json?           // extra: model, tokens, mime, durationMs, etc. (redacted + capped)

  @@index([channel, createdAt])
  @@index([agentId, createdAt])
  @@index([organizationId, createdAt])
  @@index([sessionId])
  @@index([correlationId])
  @@index([eventName])
  @@index([provider])
  @@index([actorUserId])
  @@map("event_logs")
}
```

**Migration:** `cd apps/api && bunx prisma migrate dev --name add-event-logs` then `bunx prisma generate`. All columns nullable/defaulted → additive, zero-downtime, no backfill.

> Prisma `Json` columns are TOAST-compressed in Postgres automatically; combined with the 32 KB size cap this keeps storage sane at 10K-org scale.

---

## 5. Tier 2 — Redaction, size caps, header sanitization (build FIRST, Phase 0)

**File:** `apps/api/src/common/events/redaction.util.ts`

```ts
const MAX_BYTES = Number(process.env.EVENT_LOG_MAX_PAYLOAD_BYTES ?? 32_768);

// Header names we never persist (lowercased). Drop auth + noisy transport headers;
// keep custom (x-*) and descriptive ones — matches "custom header not auth or common ones".
const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'proxy-authorization',
  'x-api-key', 'xi-api-key', 'api-subscription-key', 'x-goog-api-key',
  'x-hub-signature', 'x-hub-signature-256',
]);
const NOISE_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept', 'accept-encoding',
  'accept-language', 'cache-control', 'pragma', 'sec-fetch-mode',
  'sec-fetch-site', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile',
  'sec-ch-ua-platform', 'upgrade-insecure-requests',
]);

const SENSITIVE_KEY = /password|secret|token|apikey|api[_-]?key|authorization|credential|cookie|ssn|card/i;

/** Keep only useful, non-sensitive headers. Accepts Headers | Record | undefined. */
export function sanitizeHeaders(
  headers?: Record<string, unknown> | Headers | null,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries: [string, unknown][] =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(key) || NOISE_HEADERS.has(key)) continue;
    out[key] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Deep-redact sensitive keys + replace binary blobs. Returns a new structure. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { _binary: true, bytes: (value as Uint8Array).byteLength };
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[depth-capped]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/** Redact + enforce the byte cap. Returns Prisma-safe JSON (or undefined). */
export function capJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  const red = redact(value);
  let json: string;
  try {
    json = JSON.stringify(red);
  } catch {
    return { _unserializable: true };
  }
  if (json.length > MAX_BYTES) {
    return { _truncated: true, _bytes: json.length, preview: json.slice(0, 1000) };
  }
  return red;
}

/** Compact one-line string for AppLogger meta (redacted + 500-char cap). */
export function safeMeta(meta: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(redact(meta));
    return s.length > 500 ? s.slice(0, 500) + '…' : s;
  } catch {
    return '[meta-unserializable]';
  }
}
```

**Env (add to `apps/api/.env.example`):**
```
# --- Observability / event logs ---
EVENT_LOG_ENABLED=true              # master switch for event_logs writes
EVENT_LOG_MAX_PAYLOAD_BYTES=32768   # per-field JSON cap
EVENT_LOG_HTTP_CAPTURE=true         # auto-capture mutating HTTP requests
EVENT_LOG_RETENTION_DAYS=0          # 0 = keep forever (cleanup cron disabled)
```

---

## 6. Tier 2 — Core writer + helpers (Phase 2)

### 6.1 Extend `RequestContext` with `organizationId`

**File:** `apps/api/src/common/tracer/correlation.storage.ts` — add fields:

```ts
export interface RequestContext {
  correlationId: string;
  userId?: string;
  clerkId?: string;
  organizationId?: string;   // NEW
  method?: string;
  url?: string;
  ip?: string;               // NEW (for visitorId on auth'd routes if ever needed)
}
```

**File:** `apps/api/src/interceptors/logging.interceptor.ts` — in the existing enrich block, also set `store.organizationId = user.organizationId` and `store.ip = request.ip`.

### 6.2 `EventLogInput` type + `logEvent()` on `TracerService`

**File:** `apps/api/src/common/events/event-log.types.ts`

```ts
import { EventChannel, EventDirection } from '@prisma/client';

export interface EventLogInput {
  channel: EventChannel;
  eventName: string;                 // CAPS
  direction?: EventDirection;        // default INTERNAL
  provider?: string;

  actorUserId?: string;
  clerkId?: string;
  visitorId?: string;

  agentId?: string;
  organizationId?: string;
  sessionId?: string;
  correlationId?: string;

  requestUrl?: string;
  requestHeaders?: Record<string, unknown> | Headers | null;
  requestPayload?: unknown;

  responseStatus?: number;
  responsePayload?: unknown;

  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;

  metadata?: Record<string, unknown>;
}
```

**File:** `apps/api/src/common/tracer/tracer.service.ts` — add `logEvent()` alongside the existing `logAuditEvent()` (keep that untouched). Inject nothing new (already has `PrismaService`).

```ts
import { sanitizeHeaders, capJson } from '../events/redaction.util';
import type { EventLogInput } from '../events/event-log.types';

// ... inside TracerService ...

private get eventLogEnabled(): boolean {
  return process.env.EVENT_LOG_ENABLED !== 'false';
}

/**
 * Write one row to event_logs. Fire-and-forget: callers do `void tracer.logEvent(...)`.
 * Never throws. Auto-fills actor/org/correlation from AsyncLocalStorage when omitted.
 */
async logEvent(input: EventLogInput): Promise<void> {
  if (!this.eventLogEnabled) return;
  const ctx = getRequestContext();
  try {
    await this.prisma.eventLog.create({
      data: {
        channel: input.channel,
        eventName: input.eventName,
        direction: input.direction ?? 'INTERNAL',
        provider: input.provider ?? null,
        actorUserId: input.actorUserId ?? ctx?.userId ?? null,
        clerkId: input.clerkId ?? ctx?.clerkId ?? null,
        visitorId: input.visitorId ?? null,
        agentId: input.agentId ?? null,
        organizationId: input.organizationId ?? ctx?.organizationId ?? null,
        sessionId: input.sessionId ?? null,
        correlationId: input.correlationId ?? ctx?.correlationId ?? null,
        requestUrl: input.requestUrl ?? null,
        requestHeaders: (sanitizeHeaders(input.requestHeaders) ?? null) as never,
        requestPayload: (capJson(input.requestPayload) ?? null) as never,
        responseStatus: input.responseStatus ?? null,
        responsePayload: (capJson(input.responsePayload) ?? null) as never,
        latencyMs: input.latencyMs ?? null,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? null,
        metadata: (input.metadata ? capJson(input.metadata) : null) as never,
      },
    });
  } catch (err) {
    // Never rethrow — observability must not break business logic.
    this.logger.error(
      `logEvent failed for ${input.eventName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
```

> `as never` casts are because `capJson` returns `unknown` and Prisma's `InputJsonValue` is strict. If you prefer, cast to `Prisma.InputJsonValue`. Keep it consistent with how `logAuditEvent` already casts.

### 6.3 `tracedCall()` — standard wrapper for third-party calls

**File:** `apps/api/src/common/events/traced-call.ts`

```ts
import type { TracerService } from '../tracer/tracer.service';
import type { EventChannel } from '@prisma/client';

interface TracedCallMeta<T> {
  tracer: TracerService;
  channel: EventChannel;
  provider: string;
  /** base event in CAPS; helper appends _COMPLETED / _FAILED. e.g. 'ELEVENLABS_STT' */
  eventBase: string;
  agentId?: string;
  sessionId?: string;
  organizationId?: string;
  visitorId?: string;
  requestUrl?: string;
  requestHeaders?: Record<string, unknown> | Headers | null;
  requestPayload?: unknown;
  /** Pull responseStatus/responsePayload/metadata out of the success result. */
  extract?: (result: T) => {
    responseStatus?: number;
    responsePayload?: unknown;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Run `fn`, timing it, and emit exactly one event_logs row:
 *   `${eventBase}_COMPLETED` on success, `${eventBase}_FAILED` on throw.
 * Re-throws the original error so callers keep their existing control flow.
 * The log write is fire-and-forget (never blocks/breaks the call).
 */
export async function tracedCall<T>(meta: TracedCallMeta<T>, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const extra = meta.extract?.(result) ?? {};
    void meta.tracer.logEvent({
      channel: meta.channel,
      eventName: `${meta.eventBase}_COMPLETED`,
      direction: 'OUTBOUND',
      provider: meta.provider,
      agentId: meta.agentId,
      sessionId: meta.sessionId,
      organizationId: meta.organizationId,
      visitorId: meta.visitorId,
      requestUrl: meta.requestUrl,
      requestHeaders: meta.requestHeaders,
      requestPayload: meta.requestPayload,
      latencyMs: Math.round(performance.now() - start),
      success: true,
      ...extra,
    });
    return result;
  } catch (err) {
    void meta.tracer.logEvent({
      channel: meta.channel,
      eventName: `${meta.eventBase}_FAILED`,
      direction: 'OUTBOUND',
      provider: meta.provider,
      agentId: meta.agentId,
      sessionId: meta.sessionId,
      organizationId: meta.organizationId,
      visitorId: meta.visitorId,
      requestUrl: meta.requestUrl,
      requestHeaders: meta.requestHeaders,
      requestPayload: meta.requestPayload,
      latencyMs: Math.round(performance.now() - start),
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

### 6.4 Channel logger services (mirror the existing domain-logger pattern)

These give each area a small, named API (CAPS events) so call sites stay readable. **File pattern:** `apps/api/src/common/events/<area>.logger.ts`. Each `@Injectable()`, injects `TracerService`.

Create these (methods listed in the event catalog, §7):
- `widget.logger.ts` → `WidgetEventLogger` (channel `WIDGET`)
- `voice.logger.ts` → `VoiceEventLogger` (channel `VOICE`)
- `whatsapp.logger.ts` → `WhatsappEventLogger` (channel `WHATSAPP`)
- `internal.logger.ts` → `InternalEventLogger` (channel `INTERNAL`; classifier/extraction/handover sweep)
- `provider.logger.ts` → `ProviderEventLogger` (thin: exposes `llm()`, `stt()`, `tts()`, `whatsappApi()`, `n8n()`, `email()`, `clerk()`, `storage()` that call `tracedCall`/`logEvent`)

Example (`widget.logger.ts`):

```ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';

@Injectable()
export class WidgetEventLogger {
  constructor(private readonly tracer: TracerService) {}

  logMessageReceived(d: { agentId: string; sessionId?: string; visitorId?: string; payload: unknown }) {
    void this.tracer.logEvent({
      channel: 'WIDGET', eventName: 'WIDGET_MESSAGE_RECEIVED', direction: 'INBOUND',
      agentId: d.agentId, sessionId: d.sessionId, visitorId: d.visitorId, requestPayload: d.payload,
    });
  }

  logReplySent(d: { agentId: string; sessionId?: string; visitorId?: string; response: unknown; latencyMs?: number }) {
    void this.tracer.logEvent({
      channel: 'WIDGET', eventName: 'WIDGET_REPLY_SENT', direction: 'OUTBOUND',
      agentId: d.agentId, sessionId: d.sessionId, visitorId: d.visitorId,
      responsePayload: d.response, latencyMs: d.latencyMs,
    });
  }

  logException(d: { agentId?: string; sessionId?: string; error: unknown }) {
    void this.tracer.logEvent({
      channel: 'WIDGET', eventName: 'WIDGET_MESSAGE_EXCEPTION', direction: 'INBOUND',
      agentId: d.agentId, sessionId: d.sessionId, success: false,
      errorMessage: d.error instanceof Error ? d.error.message : String(d.error),
    });
  }
}
```

### 6.5 `EventsModule` (global, wires the loggers)

**File:** `apps/api/src/common/events/events.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { TracerModule } from '../tracer/tracer.module';
import { WidgetEventLogger } from './widget.logger';
import { VoiceEventLogger } from './voice.logger';
import { WhatsappEventLogger } from './whatsapp.logger';
import { InternalEventLogger } from './internal.logger';
import { ProviderEventLogger } from './provider.logger';

const loggers = [WidgetEventLogger, VoiceEventLogger, WhatsappEventLogger, InternalEventLogger, ProviderEventLogger];

@Global()
@Module({ imports: [TracerModule], providers: loggers, exports: loggers })
export class EventsModule {}
```

Import `EventsModule` once in `app.module.ts`. Because it's `@Global()`, every module can inject the loggers without re-importing. (`TracerModule` is already `@Global()` too.)

---

## 7. Event-name catalog (the exact CAPS strings to emit)

> Naming rule: `<DOMAIN>_<NOUN>_<VERB-PAST>`. Third-party: `<PROVIDER>_<OP>_<COMPLETED|FAILED>`. One event per meaningful outcome. Keep this list authoritative — add here when adding events.

### WIDGET (channel `WIDGET`) — `public-chat.controller.ts`, `chat.service.ts`, `direct-chat.service.ts`
- `WIDGET_SESSION_STARTED` (INBOUND) — new ChatSession created for a visitor
- `WIDGET_MESSAGE_RECEIVED` (INBOUND) — user message accepted (payload = text + sessionId; visitorId = masked IP)
- `WIDGET_REPLY_SENT` (OUTBOUND) — assistant reply streamed/returned (responsePayload = final text, latency)
- `WIDGET_MESSAGE_RATE_LIMITED` (INBOUND, success:false)
- `WIDGET_MESSAGE_EXCEPTION` (INBOUND, success:false)
- `WIDGET_WARMUP_REQUESTED` (INBOUND) — `/public/chat/warmup`

### VOICE (channel `VOICE`) — `voice.controller.ts`, `voice.service.ts`
- `VOICE_CONVERSATION_RECEIVED` (INBOUND)
- `VOICE_REPLY_SENT` (OUTBOUND)
- `VOICE_CONVERSATION_EXCEPTION` (INBOUND, success:false)
- third-party (see Providers): `ELEVENLABS_STT_*`, `SARVAM_STT_*`, `DEEPGRAM_STT_*`, `ELEVENLABS_TTS_*`, `SARVAM_TTS_*`

### WHATSAPP (channel `WHATSAPP`) — `whatsapp-webhook.controller.ts`, `whatsapp-inbound.service.ts`, `whatsapp-send.service.ts`
- `WHATSAPP_WEBHOOK_VERIFIED` (INBOUND) — GET handshake
- `WHATSAPP_MESSAGE_RECEIVED` (INBOUND) — inbound message (visitorId = masked phone)
- `WHATSAPP_TYPING_SENT` (OUTBOUND)
- `WHATSAPP_REPLY_SENT` (OUTBOUND) — text or voice reply
- `WHATSAPP_INBOUND_EXCEPTION` (INBOUND, success:false)
- third-party (Graph API, provider `META_WHATSAPP`): `META_WHATSAPP_SEND_TEXT_*`, `META_WHATSAPP_UPLOAD_MEDIA_*`, `META_WHATSAPP_SEND_AUDIO_*`, `META_WHATSAPP_GET_MEDIA_*`, `META_WHATSAPP_MARK_READ_*`

### DASHBOARD (channel `DASHBOARD`)
- Auto-captured by the HTTP interceptor for mutating routes (§8): `DASHBOARD_HTTP_<METHOD>` (e.g. `DASHBOARD_HTTP_POST`) with route/url/body/response.
- Semantic CRUD already covered by existing `audit_logs` domain loggers — **do not duplicate** into `event_logs` in v1 (consolidation is Phase 8).
- Third-party from dashboard actions: `RESEND_EMAIL_*` (provider `RESEND`), `CLERK_INVITATION_*` (`CLERK`), `SUPABASE_STORAGE_*` (`SUPABASE`), `AGENT_WEBHOOK_TEST_*` (provider = agent webhook host).

### INTERNAL (channel `INTERNAL`) — cron/background
- `CLASSIFIER_RUN_STARTED` / `CLASSIFIER_RUN_COMPLETED` / `CLASSIFIER_SESSION_CLASSIFIED` / `CLASSIFIER_RUN_FAILED`
- `DATA_EXTRACTION_RUN_STARTED` / `DATA_EXTRACTION_SESSION_EXTRACTED` / `DATA_EXTRACTION_RUN_COMPLETED` / `DATA_EXTRACTION_RUN_FAILED`
- `HANDOVER_SWEEP_STARTED` / `HANDOVER_SWEEP_COMPLETED`
- Handover business events (raise here OR in handover.service): `HANDOVER_REQUESTED`, `HANDOVER_TAKEN_OVER`, `HANDOVER_RESOLVED`
- third-party from these jobs: `OPENAI_CLASSIFY_*`, `OPENAI_EXTRACT_*` (provider `OPENAI`)

### Providers (cross-channel; set `channel` to the calling channel) — `llm.service.ts`, voice providers, etc.
- LLM: `LLM_COMPLETION_*` (generateCompletion) / `LLM_STREAM_*` (streamCompletion); `provider` = resolved from model id (`ANTHROPIC`/`OPENAI`/`GROQ`/`GEMINI`/`OPENROUTER`/`SARVAM`/`CEREBRAS`); `metadata` = `{ model, requestedModel, inputTokens, outputTokens, cost, finishReason }`. **Do NOT store the full prompt/messages in `requestPayload`** — store `{ messageCount, systemPromptChars, temperature, maxTokens, tools: tools?Object.keys:undefined }`. The full replay already lives in `chat_traces`.
- STT/TTS: see §9.5.

---

## 8. Automatic HTTP envelope capture (Phase 3)

Gives blanket coverage of "every mutating path" without touching 44 services. Extend the existing interceptor; **do not** create a parallel one.

**File:** `apps/api/src/interceptors/logging.interceptor.ts`

1. Keep the existing stdout `←` log untouched.
2. Add: inject `TracerService` (constructor). Mark the class so it can resolve channel.
3. On `tap.next` and `tap.error`, **only for `POST|PUT|PATCH|DELETE`** and when `EVENT_LOG_HTTP_CAPTURE !== 'false'`, fire-and-forget a `tracer.logEvent`:

```ts
const method = request.method;
if (['POST','PUT','PATCH','DELETE'].includes(method) && process.env.EVENT_LOG_HTTP_CAPTURE !== 'false') {
  const channel = resolveChannel(request.originalUrl); // see helper below
  const { agentId, organizationId } = extractEntityIds(request.originalUrl, request.params);
  void this.tracer.logEvent({
    channel,
    eventName: `${channel}_HTTP_${method}`,
    direction: 'INBOUND',
    agentId,                                                  // route-aware (see helper)
    organizationId,                                           // route-aware (see helper)
    requestUrl: request.originalUrl,
    requestHeaders: request.headers,                          // sanitized in tracer
    requestPayload: request.body,                             // redacted + capped
    responseStatus: statusCode,
    responsePayload: responseBodyForLogging,                 // the value returned by handler
    latencyMs: Date.now() - now,
    success: statusCode < 400,
    errorMessage: errMessage,                                 // on error branch
  });
}
```

> `responseBodyForLogging` — in the `tap.next` callback the emitted value is the handler's return. For **streaming SSE endpoints** (widget/voice), the handler writes to `res` directly and returns nothing — that's fine, `responsePayload` stays null and the explicit `WIDGET_REPLY_SENT` event carries the reply. Don't try to capture streamed bytes here.

**File:** `apps/api/src/common/events/resolve-channel.ts`

```ts
import type { EventChannel } from '@prisma/client';

export function resolveChannel(url: string): EventChannel {
  if (url.includes('/public/voice')) return 'VOICE';
  if (url.includes('/public/whatsapp') || url.includes('/whatsapp')) return 'WHATSAPP';
  if (url.includes('/public/chat') || url.includes('/public/agents')) return 'WIDGET';
  if (url.includes('/internal/') || url.includes('/klivo/v1/internal')) return 'INTERNAL';
  return 'DASHBOARD';
}

/**
 * Pull the agentId / organizationId into their DEDICATED columns ONLY when the
 * route is actually scoped to that entity. The agent-editor routes name the
 * param inconsistently (`:id` on /agents/:id, /agents/:id/theme, /agents/:id/files;
 * `:agentId` on /agents/:agentId/knowledge, /agents/:agentId/data-fields), so we
 * accept both — but we must NOT blindly take `params.id`, or `PATCH /organizations/:id`
 * would drop an org id into the agentId column. Route prefix decides which column.
 */
export function extractEntityIds(
  url: string,
  params: Record<string, string | undefined> = {},
): { agentId?: string; organizationId?: string } {
  const out: { agentId?: string; organizationId?: string } = {};
  if (url.includes('/agents/')) out.agentId = params.agentId ?? params.id;
  if (url.includes('/organizations/')) out.organizationId = params.organizationId ?? params.id;
  return out;
}
```

> This is why the agent editor is fully covered: every editor save (`PATCH /agents/:id`,
> `PUT /agents/:id/theme`, `PUT /agents/:agentId/data-fields`, `PUT /agents/:agentId/knowledge`,
> `POST /agents/:id/files`, `PATCH /agents/:id/webhook`, …) is a mutating request, so the
> interceptor writes one `event_logs` row with **agentId** (column), **actorUserId/clerkId**
> (from `request.user.id` via ALS), **requestPayload** (the changed fields), **responsePayload**
> (what we returned), status + latency. On top of that, the existing `AgentLoggerService`
> already emits semantic `AGENT_UPDATED` / `AGENT_THEME_UPDATED` / `AGENT_DOMAINS_UPDATED`
> events (to `audit_logs` today) with agentId + userId.

**File:** `apps/api/src/filters/all-exceptions.filter.ts` — in the `status >= 500` branch (and 4xx for mutating methods), also `void this.tracer.logEvent({...})` with the failed request envelope (`success:false`, `errorMessage`). Inject `TracerService`. Keep existing Sentry + stdout behavior.

> The filter needs `TracerService`; it's already `@Injectable()` and registered as `APP_FILTER` via class, so Nest will inject it. Verify `TracerModule` is imported where the filter is provided (it's `@Global()`, so fine).

---

## 9. Third-party call wrapping — exact per-site instructions

For each site: (a) switch console logs to `AppLogger`, (b) wrap the outbound call with `tracedCall` **or** an explicit `providerLogger` call. **Keep existing behavior/return values/throws identical** — logging is additive.

### 9.1 LLM — `apps/api/src/modules/ai/llm.service.ts`
Inject `TracerService` (or `ProviderEventLogger`). Wrap the bodies of `generateCompletion` and `streamCompletion`.

- `generateCompletion`: wrap the `generateText(...)` call. `provider` = derive from `request.modelId` (there is an existing `parseModelId`/prefix logic — reuse it; map prefix `openai:`→`OPENAI`, `groq:`→`GROQ`, `gemini:`→`GEMINI`, `sarvam:`→`SARVAM`, `cerebras:`→`CEREBRAS`, default→`OPENROUTER`; if the resolved model is an Anthropic model via OpenRouter, still `OPENROUTER`). On success, `metadata` = `{ model: result.model, requestedModel: request.modelId, ...usage, cost, finishReason }`. `requestPayload` = `{ messageCount: request.messages.length, systemPromptChars: request.systemPrompt?.length, temperature, maxTokens, hasTools: !!request.tools }`.
- `streamCompletion`: the clean success/failure points are where the `completion` promise resolves (`resolveCompletion`) / rejects (`rejectCompletion`) inside the async generator. Emit `LLM_STREAM_COMPLETED` when `resolveCompletion(final)` is called, `LLM_STREAM_FAILED` on the catch that calls `rejectCompletion(wrapError(err))`. Use the `tracer` reference captured the same way `diagnosticsLogger`/`wrapError` are bound (the generator can't see `this`).
- `agentId`/`sessionId`: `request.agentId` exists on the LlmCompletionRequest object (per the third-party audit). Pass it; channel = the request's channel if available, else `WIDGET` for chat. If channel isn't threaded, default `WIDGET` and note it (acceptable — provider + agentId are the important keys).

> Token/cost detail also continues to flow into `llm_usage` and `chat_traces` — don't remove those. `event_logs` is the *call-envelope* record (provider, latency, success/fail, model), complementary to the metrics tables.

### 9.2 WhatsApp Graph API — `apps/api/src/modules/whatsapp/whatsapp-send.service.ts`
Inject `TracerService`. Wrap each `fetch` (`sendText`, `uploadMedia`, `sendAudio`, `getMedia`/download, `markReadAndTyping`) with `tracedCall`, `provider:'META_WHATSAPP'`, `channel:'WHATSAPP'`, `eventBase` per method (`META_WHATSAPP_SEND_TEXT`, …).
- `requestUrl` = the Graph URL; `requestHeaders` = **do not pass the `Authorization` header** (the tracer strips it anyway, but don't even build it into the log object — pass only `{ 'content-type': ... }` or omit).
- `requestPayload` = the JSON body **without** the token (e.g. `{ to: maskPhone(to), type, bodyChars: body.length }` for text; `{ to: maskPhone(to), mediaId }` for audio). Never log full message bodies or media bytes.
- `extract` from response: `{ responseStatus: res.status, responsePayload: { wamid } }`. For the existing non-OK path that throws, `tracedCall` records `_FAILED` automatically; you can keep the existing `this.log.error(...)` line too.

### 9.3 n8n — `apps/api/src/services/n8n-streaming.service.ts` (`streamFromWebhookUrl`) and `apps/api/src/services/chat.service.ts` (`callN8nWebhook`)
Wrap the `fetch` with `tracedCall`, `provider:'N8N'`, channel = `WIDGET` (n8n mode is a widget routing option). `requestUrl` = webhook URL (host only is fine), `requestPayload` = `{ sessionId, chatInputChars }`. Note these are agent-defined webhooks → `provider:'N8N'` is fine as the label.

### 9.4 Email (Resend) — `apps/api/src/services/email.service.ts`
Already has `EmailLoggerService` → `audit_logs`. **Add** an `event_logs` row too via `ProviderEventLogger.email()`/`tracedCall`, `provider:'RESEND'`, channel `DASHBOARD` (or `INTERNAL` if no request ctx), `eventBase:'RESEND_EMAIL'`. `requestPayload` = `{ to: options.to, subject: options.subject }` (no HTML body). `extract` = `{ responsePayload: { id: data?.id } }`. Keep the existing `emailLogger` calls.

### 9.5 Voice STT/TTS — `apps/api/src/modules/voice/providers/{elevenlabs,sarvam,deepgram}.provider.ts` (+ `voice.service.ts`)
- **Thread `agentId`/`sessionId` into the provider calls.** Today STT/TTS request interfaces don't carry them. Add optional `agentId?`/`sessionId?` to `STTRequest`/`TTSRequest` (in `voice-stream.interface.ts` or wherever they're defined) and populate at the `voice.service.ts` call sites. **This is the one change that touches more than the logging layer — keep it minimal and call it out in the PR.**
- Wrap each provider `fetch` (`transcribe`, `synthesize`) with `tracedCall`, channel `VOICE` (or pass-through the caller's channel for WhatsApp voice), provider `ELEVENLABS`/`SARVAM`/`DEEPGRAM`, `eventBase` = `<PROVIDER>_STT` / `<PROVIDER>_TTS`.
- `requestPayload` = `{ audioBytes, audioMime, languageHint }` (STT) or `{ textChars, voiceId, format }` (TTS). **Never the audio bytes or full text.**
- `extract`: STT → `{ responsePayload: { transcriptChars, detectedLanguage, confidence }, metadata: { latencyMs } }`; TTS → `{ metadata: { audioBytes, format, latencyMs } }`.
- Also wrap the WebSocket TTS sessions where feasible (emit one `_COMPLETED`/`_FAILED` per session, with chunk count + bytes in `metadata`). If a WS path is too awkward, log a single session-summary event in `voice.service.ts` instead — note it.

### 9.6 Clerk — `apps/api/src/services/clerk-management.service.ts`
Already has `ClerkLoggerService` → `audit_logs`. Add `event_logs` via `ProviderEventLogger.clerk()`/`tracedCall`, `provider:'CLERK'`, channel `DASHBOARD`, `eventBase:'CLERK_INVITATION'` (create) / `'CLERK_INVITATION_REVOKE'`. `requestPayload` = `{ email, expiresInDays }`. Keep existing clerk logger calls.

### 9.7 Supabase storage — `apps/api/src/services/supabase-storage.service.ts`
Wrap `upload`/`remove`/`getPublicUrl` (the network ones) with `tracedCall`, `provider:'SUPABASE'`, channel `DASHBOARD`, `eventBase:'SUPABASE_STORAGE_UPLOAD'`/`_REMOVE`. `requestPayload` = `{ bucket, path, sizeBytes, mime }`. Never the file bytes.

### 9.8 Agent webhook test — `apps/api/src/services/agents.service.ts` (`testWebhook`)
Wrap the `fetch` with `tracedCall`, `provider:'AGENT_WEBHOOK'`, channel `DASHBOARD`, `eventBase:'AGENT_WEBHOOK_TEST'`. `requestUrl` = the webhook host. Useful for debugging customer webhook setups.

---

## 10. Console-logging coverage map (Tier 1, applied within each phase)

Convert these to `AppLogger` and add step/branch/catch logs per §3.3. (Grouped by phase; the ~58 `new Logger` files all eventually get converted — phases below assign them.)

- **Widget/chat:** `public-chat.controller.ts`, `chat.service.ts`, `direct-chat.service.ts`, `message-rate-limit.service.ts`, `message-metrics.service.ts`, `n8n-streaming.service.ts`, `context-assembly.service.ts`, `hybrid-context.strategy.ts`, `summarization.service.ts`.
- **AI core:** `llm.service.ts`, `ai-sdk.service.ts`, `token-counter.service.ts`, `prompt-template.service.ts`, `usage-tracking.service.ts`, `ai-classifier.service.ts`.
- **Voice:** `voice.controller.ts`, `voices.controller.ts`, `voice.service.ts`, `providers/{stub,sarvam,deepgram,elevenlabs}.provider.ts`.
- **WhatsApp:** `whatsapp-webhook.controller.ts`, `whatsapp-channel.controller.ts`, `whatsapp-inbound.service.ts`, `whatsapp-send.service.ts`, `whatsapp-config.service.ts`, `whatsapp-channel.service.ts`.
- **Dashboard CRUD:** `agents.service.ts`, `agent-themes.service.ts`, `agent-knowledge.service.ts`, `agent-data-fields.service.ts`, `files.service.ts`, `organizations.service.ts`, `organization-members.service.ts`, `users.service.ts`, `invitations.service.ts`, `conversations.service.ts`, `analytics.service.ts`, `email.service.ts`, `clerk-management.service.ts`, `supabase-storage.service.ts`, all controllers in `controllers/**`.
- **Background/internal:** `conversation-classifier.service.ts`, `data-extraction.service.ts`, `handover.service.ts`, `realtime.service.ts`, internal controllers.

---

## 11. Build sequence (one PR per phase)

Branch per phase off `develop`: `feature/observability-p0`, `-p1`, … Each PR: implement → add/adjust unit tests in `apps/api/test/` → `bun run lint && bun run check-types && bun run build && bun run test:cov` → open PR to `develop`. Then run `/bmad-code-review` and fix findings (per `CLAUDE.md`).

### Phase 0 — Foundation (no behavior change)
- CREATE `common/events/redaction.util.ts` (§5), `common/events/event-log.types.ts` (§6.2), `common/logger/app-logger.ts` (§3.1), `common/events/resolve-channel.ts` (§8).
- MODIFY `common/tracer/correlation.storage.ts` (+organizationId, +ip) and `.env.example` (env vars).
- Export `AppLogger` from `common/logger/index.ts`.
- TESTS: `test/common/events/redaction.util.spec.ts` (header strip, key redaction, size cap, binary guard), `test/common/logger/app-logger.spec.ts` (format string, error+stack).

### Phase 1 — Schema
- MODIFY `prisma/schema.prisma` (enums + `EventLog`, §4). `bunx prisma migrate dev --name add-event-logs` + `bunx prisma generate`.
- Verify migration SQL is additive only.

### Phase 2 — Core writer + loggers
- MODIFY `common/tracer/tracer.service.ts` (`logEvent`, §6.2).
- CREATE `common/events/traced-call.ts` (§6.3), `widget.logger.ts`, `voice.logger.ts`, `whatsapp.logger.ts`, `internal.logger.ts`, `provider.logger.ts` (§6.4), `events.module.ts` (§6.5).
- MODIFY `app.module.ts` (import `EventsModule`).
- TESTS: `test/common/tracer/tracer.service.spec.ts` (extend: logEvent fills ctx, redacts, never throws on prisma error), `test/common/events/traced-call.spec.ts` (COMPLETED/FAILED emitted, rethrows, fire-and-forget).

### Phase 3 — Automatic HTTP capture
- MODIFY `interceptors/logging.interceptor.ts` (§8, inject TracerService, mutating-only write), `filters/all-exceptions.filter.ts` (§8, failed-request write).
- TESTS: extend `test/interceptors/logging.interceptor.spec.ts` (POST writes a row, GET does not, channel resolved), `test/filters/all-exceptions.filter.spec.ts` (500 writes failed envelope).

### Phase 4 — Widget + chat path + LLM third-party
- Tier 1: convert §10 "Widget/chat" + "AI core" files to `AppLogger`, add step/branch/catch logs.
- Tier 2: emit WIDGET events (§7) in `public-chat.controller.ts` / `chat.service.ts` / `direct-chat.service.ts`; wrap LLM calls in `llm.service.ts` (§9.1).
- TESTS: update the affected service specs (mock the loggers; assert events emitted on key paths). Existing specs that assert `new Logger` usage may need the mock swapped to `AppLogger`.

### Phase 5 — Voice path + STT/TTS third-party
- Tier 1: convert §10 "Voice" files.
- Tier 2: VOICE events in `voice.controller.ts`/`voice.service.ts`; thread `agentId`/`sessionId` into STT/TTS interfaces; wrap provider calls (§9.5).
- TESTS: `voice.controller.spec.ts` (exists — extend), provider specs as needed.

### Phase 6 — WhatsApp path + Graph/n8n third-party
- Tier 1: convert §10 "WhatsApp" files.
- Tier 2: WHATSAPP events in webhook controller + inbound service; wrap Graph API calls in `whatsapp-send.service.ts` (§9.2); wrap n8n (§9.3).
- TESTS: `whatsapp-inbound.service.spec.ts` (exists — extend).

### Phase 7 — Dashboard + background + remaining third-party
- Tier 1: convert §10 "Dashboard CRUD" + "Background/internal" files.
- Tier 2: INTERNAL events in classifier/extraction/handover-sweep; handover business events; third-party wraps for Resend (§9.4), Clerk (§9.6), Supabase (§9.7), webhook test (§9.8); DASHBOARD HTTP capture already live from Phase 3.
- TESTS: affected service specs.

### Phase 8 — Retention + (optional) read API/consolidation
- CREATE a retention cron endpoint (mirror the existing internal-secret cron pattern, e.g. `/internal/event-logs/cleanup`) that deletes rows older than `EVENT_LOG_RETENTION_DAYS` **only when > 0** (default 0 = no-op). Guard with the same internal secret as classifier/extraction.
- OPTIONAL: read API + dashboard viewer (`GET /event-logs?channel=WIDGET&agentId=…` paginated, RBAC-guarded) so "widget logs"/"dashboard logs" are visible in-app.
- OPTIONAL: consolidation — re-point the 6 `audit_logs` domain loggers to also/instead write `event_logs` (channel `DASHBOARD`, direction `INTERNAL`), then deprecate `audit_logs`.

---

## 12. File summary

| Action | File | Phase | Purpose |
|---|---|---|---|
| CREATE | `common/events/redaction.util.ts` | 0 | redact / sanitizeHeaders / capJson / safeMeta |
| CREATE | `common/events/event-log.types.ts` | 0 | `EventLogInput` |
| CREATE | `common/logger/app-logger.ts` | 0 | `[service] [fn] - msg` wrapper |
| CREATE | `common/events/resolve-channel.ts` | 0 | url → EventChannel |
| MODIFY | `common/tracer/correlation.storage.ts` | 0 | +organizationId, +ip |
| MODIFY | `apps/api/.env.example` | 0 | EVENT_LOG_* vars |
| MODIFY | `common/logger/index.ts` | 0 | export AppLogger |
| MODIFY | `prisma/schema.prisma` | 1 | EventChannel, EventDirection, EventLog |
| MODIFY | `common/tracer/tracer.service.ts` | 2 | `logEvent()` |
| CREATE | `common/events/traced-call.ts` | 2 | third-party wrapper |
| CREATE | `common/events/{widget,voice,whatsapp,internal,provider}.logger.ts` | 2 | channel loggers |
| CREATE | `common/events/events.module.ts` | 2 | global wiring |
| MODIFY | `modules/app.module.ts` | 2 | import EventsModule |
| MODIFY | `interceptors/logging.interceptor.ts` | 3 | HTTP envelope capture + org/ip enrich |
| MODIFY | `filters/all-exceptions.filter.ts` | 3 | failed-request envelope |
| MODIFY | widget/chat/AI files (§10) | 4 | AppLogger + WIDGET + LLM events |
| MODIFY | voice files (§10) | 5 | AppLogger + VOICE + STT/TTS events |
| MODIFY | whatsapp files (§10) | 6 | AppLogger + WHATSAPP + Graph/n8n events |
| MODIFY | dashboard/internal files (§10) | 7 | AppLogger + INTERNAL + Resend/Clerk/Supabase events |
| CREATE | retention cron + (optional) read API | 8 | lifecycle / viewer |
| CREATE | tests per phase (`apps/api/test/**`) | 0–7 | unit coverage |

---

## 13. Verification (per phase + end-to-end)

Per phase: `bun run lint && bun run check-types && bun run build`; if `apps/api` changed, `bun run test:cov`.

End-to-end smoke after Phase 6:
1. Start backend. Send a widget message → expect stdout lines `[ChatService] [sendMessage] - …` and `event_logs` rows `WIDGET_MESSAGE_RECEIVED`, `LLM_STREAM_COMPLETED`, `WIDGET_REPLY_SENT`, all sharing one `correlationId`.
2. Send a WhatsApp message → `WHATSAPP_MESSAGE_RECEIVED`, provider `META_WHATSAPP_*`, `WHATSAPP_REPLY_SENT`.
3. Do a voice turn → STT/TTS provider events with `provider` + `latencyMs`, no audio bytes stored.
4. Trigger a dashboard mutation (create agent) → `DASHBOARD_HTTP_POST` row + existing `audit_logs` `AGENT_CREATED`.
5. Confirm **no** `Authorization`/cookie/api-key values anywhere in `event_logs` (`SELECT request_headers, request_payload FROM event_logs LIMIT 50;`).
6. Confirm GET requests produce **no** `event_logs` rows.
7. Kill the DB mid-request → business response still succeeds (fire-and-forget proven).

---

## 14. Non-goals (v1)
- No pino for app logs (NestJS Logger only).
- No raw audio/file byte storage (metadata + text-length only).
- No change to `chat_traces` / `llm_usage` (they remain the metrics/replay source; `event_logs` is the call-envelope source — linked by `correlationId`/`sessionId`).
- No log shipping to external SIEM (a sink can be added later).
- No per-GET capture, no sampling (writes-only keeps volume bounded).

---

## 15. Appendix A — COMPLETE coverage matrix (every file accounted for)

Verified against the actual file tree on 2026-06-28: **23 controllers, 47 services, 4 voice providers, 1 strategy class, 6 guards, 1 passport strategy**. Every file below has an assigned coverage mechanism and phase. If a file isn't in this table, it didn't exist at plan time — add it here when created.

**Coverage legend:**
- **AUTO** = mutating routes auto-captured by the Phase-3 HTTP interceptor (guaranteed, no per-file code). GET-only endpoints get console logs only (no `event_logs` row by design).
- **EVENT** = explicit semantic `event_logs` events (channel logger).
- **3P** = third-party outbound call wrapped with `tracedCall` / provider logger.
- **CONSOLE** = `AppLogger` step/branch/catch logging (§3.3).
- **AUDIT** = already emits to `audit_logs` via an existing domain logger (kept).
- **MINIMAL** = infra/framework file — console logging of failures/fallbacks only; no events.
- **SKIP** = no work (pure logging sink, trivial wrapper, or dev-only).

### A.1 Controllers (23) — all mutating routes are AUTO-covered

| # | Controller | Channel | Coverage | Phase |
|---|---|---|---|---|
| 1 | `agents.controller.ts` | DASHBOARD | AUTO + EVENT(AGENT_*) + CONSOLE | 4/7 |
| 2 | `agents/agent-themes.controller.ts` | DASHBOARD | AUTO + EVENT(AGENT_THEME_*) + CONSOLE | 7 |
| 3 | `agents/agent-knowledge.controller.ts` | DASHBOARD | AUTO + EVENT + CONSOLE | 7 |
| 4 | `agents/agent-data-fields.controller.ts` | DASHBOARD | AUTO + EVENT + CONSOLE | 7 |
| 5 | `agents/agent-files.controller.ts` | DASHBOARD | AUTO + 3P(SUPABASE) + CONSOLE | 7 |
| 6 | `organizations/organizations.controller.ts` | DASHBOARD | AUTO + AUDIT(ORG_*) + CONSOLE | 7 |
| 7 | `organizations/organization-members.controller.ts` | DASHBOARD | AUTO + AUDIT(MEMBER_*) + CONSOLE | 7 |
| 8 | `auth/users.controller.ts` | DASHBOARD | AUTO + AUDIT(USER_*) + CONSOLE | 7 |
| 9 | `invitations/invitations.controller.ts` | DASHBOARD | AUTO + AUDIT(INVITATION_*) + 3P(CLERK,RESEND) + CONSOLE | 7 |
| 10 | `conversations/conversations.controller.ts` | DASHBOARD | AUTO (mostly GET→console) + CONSOLE | 7 |
| 11 | `analytics/analytics.controller.ts` | DASHBOARD | GET→CONSOLE only (no event rows) | 7 |
| 12 | `handover/handover.controller.ts` | DASHBOARD | AUTO + EVENT(HANDOVER_*) + CONSOLE | 7 |
| 13 | `public/public-chat.controller.ts` | WIDGET | AUTO + EVENT(WIDGET_*) + 3P(LLM,N8N) + CONSOLE | 4 |
| 14 | `public/public-agents.controller.ts` | WIDGET | AUTO + EVENT(WIDGET_SESSION_STARTED) + CONSOLE | 4 |
| 15 | `voice/voice.controller.ts` | VOICE | AUTO + EVENT(VOICE_*) + 3P(STT,TTS) + CONSOLE | 5 |
| 16 | `voice/voices.controller.ts` | VOICE | GET→CONSOLE only | 5 |
| 17 | `whatsapp/whatsapp-webhook.controller.ts` | WHATSAPP | AUTO + EVENT(WHATSAPP_*) + CONSOLE | 6 |
| 18 | `whatsapp/whatsapp-channel.controller.ts` | DASHBOARD | AUTO + EVENT(WHATSAPP_CHANNEL_*) + CONSOLE | 6 |
| 19 | `internal/classifier.controller.ts` | INTERNAL | AUTO + EVENT(CLASSIFIER_*) + CONSOLE | 7 |
| 20 | `data-extraction/data-extraction.controller.ts` | INTERNAL | AUTO + EVENT(DATA_EXTRACTION_*) + CONSOLE | 7 |
| 21 | `internal/handover-sweep.controller.ts` | INTERNAL | AUTO + EVENT(HANDOVER_SWEEP_*) + CONSOLE | 7 |
| 22 | `health/health.controller.ts` | SYSTEM | SKIP (GET health) | — |
| 23 | `dev/dev-ai.controller.ts` | — | SKIP (dev-only module) | — |

### A.2 Business / HTTP-path services (full coverage)

| Service | Coverage | Phase |
|---|---|---|
| `services/chat.service.ts` | CONSOLE + EVENT(WIDGET) + 3P(N8N) | 4/6 |
| `modules/ai/direct-chat.service.ts` | CONSOLE + EVENT + (drives AiTrace) | 4 |
| `modules/ai/llm.service.ts` | CONSOLE + 3P(LLM_*) | 4 |
| `modules/ai/ai-sdk.service.ts` | CONSOLE (provider init/warmup) | 4 |
| `modules/ai/context-assembly.service.ts` | CONSOLE | 4 |
| `modules/ai/prompt-template.service.ts` | CONSOLE | 4 |
| `modules/ai/summarization.service.ts` | CONSOLE + 3P(LLM) | 4 |
| `modules/ai/token-counter.service.ts` | CONSOLE | 4 |
| `modules/ai/usage-tracking.service.ts` | CONSOLE (writes llm_usage — kept) | 4 |
| `modules/ai/strategies/hybrid-context.strategy.ts` | CONSOLE | 4 |
| `common/ai/ai-classifier.service.ts` | CONSOLE + 3P(OPENAI_*) | 7 |
| `services/message-metrics.service.ts` | CONSOLE | 4 |
| `services/message-rate-limit.service.ts` | CONSOLE + EVENT(rate-limited) | 4 |
| `services/n8n-streaming.service.ts` | CONSOLE + 3P(N8N_*) | 6 |
| `modules/voice/voice.service.ts` | CONSOLE + EVENT(VOICE) | 5 |
| `modules/voice/providers/elevenlabs.provider.ts` | CONSOLE + 3P(ELEVENLABS_*) | 5 |
| `modules/voice/providers/sarvam.provider.ts` | CONSOLE + 3P(SARVAM_*) | 5 |
| `modules/voice/providers/deepgram.provider.ts` | CONSOLE + 3P(DEEPGRAM_*) | 5 |
| `modules/voice/providers/stub.provider.ts` | CONSOLE (test stub) | 5 |
| `modules/whatsapp/whatsapp-inbound.service.ts` | CONSOLE + EVENT(WHATSAPP_*) | 6 |
| `modules/whatsapp/whatsapp-send.service.ts` | CONSOLE + 3P(META_WHATSAPP_*) | 6 |
| `modules/whatsapp/whatsapp-channel.service.ts` | CONSOLE + EVENT | 6 |
| `modules/whatsapp/whatsapp-config.service.ts` | CONSOLE | 6 |
| `services/agents.service.ts` | CONSOLE + AUDIT(AGENT_*) + 3P(AGENT_WEBHOOK_TEST) | 4/7 |
| `services/agent-themes.service.ts` | CONSOLE + AUDIT | 7 |
| `services/agent-knowledge.service.ts` | CONSOLE + EVENT | 7 |
| `services/agent-data-fields.service.ts` | CONSOLE + EVENT | 7 |
| `services/files.service.ts` | CONSOLE + 3P(SUPABASE) | 7 |
| `services/organizations.service.ts` | CONSOLE + AUDIT | 7 |
| `services/organization-members.service.ts` | CONSOLE + AUDIT | 7 |
| `services/users.service.ts` | CONSOLE + AUDIT | 7 |
| `services/invitations.service.ts` | CONSOLE + AUDIT | 7 |
| `services/conversations.service.ts` | CONSOLE | 7 |
| `services/analytics.service.ts` | CONSOLE | 7 |
| `services/handover.service.ts` | CONSOLE + EVENT(HANDOVER_*) | 7 |
| `services/realtime.service.ts` | CONSOLE | 7 |
| `services/conversation-classifier.service.ts` | CONSOLE + EVENT(CLASSIFIER_*) + 3P(OPENAI) | 7 |
| `services/data-extraction.service.ts` | CONSOLE + EVENT(DATA_EXTRACTION_*) + 3P(OPENAI) | 7 |
| `services/email.service.ts` | CONSOLE + AUDIT + 3P(RESEND_*) | 7 |
| `services/clerk-management.service.ts` | CONSOLE + AUDIT + 3P(CLERK_*) | 7 |
| `services/supabase-storage.service.ts` | CONSOLE + 3P(SUPABASE_STORAGE_*) | 7 |

### A.3 The logging machinery itself (kept / extended, not "instrumented")

| File | Note |
|---|---|
| `common/tracer/tracer.service.ts` | Extended with `logEvent()` (P2). Already logs. |
| `modules/ai/trace/ai-trace.service.ts` | The ChatTrace writer (its own pino logger). Leave as-is. |
| `services/prisma.service.ts` | MINIMAL — connect/disconnect lifecycle logs only. |
| `common/sentry/sentry.service.ts` | SKIP — it IS the error sink. |
| `services/app.service.ts` | SKIP — trivial. |

### A.4 Infrastructure / common services — MINIMAL (console failures/fallbacks only, no events)

| File | What to log | Phase |
|---|---|---|
| `common/crypto/crypto.service.ts` | decrypt/encrypt failures (NEVER the secret/plaintext) | 7 |
| `common/redis/redis.service.ts` | connect, fail-open fallthrough (already partly logs) | 7 |
| `common/redis/rate-limiter.service.ts` | limiter errors / fail-open | 7 |
| `common/cache/agent-cache.service.ts` | cache miss → DB fallthrough | 4 |
| `common/cache/widget-cors-cache.service.ts` | cache miss / refresh | 4 |
| `common/security/hmac.service.ts` | signature mismatch (warn) | 6 |
| `common/rbac/rbac.service.ts` | permission denials (warn) | 7 |
| `common/tracer/tracer.service.ts` | (see A.3) | — |

### A.5 Guards / strategy / middleware / filters / interceptors — targeted

| File | What to log | Phase |
|---|---|---|
| `guards/jwt-auth.guard.ts` | auth rejections (warn) | 7 |
| `guards/user-sync.guard.ts` | sync failures (error) | 7 |
| `guards/rate-limit.guard.ts` | throttle hits (warn) | 7 |
| `guards/tenant.guard.ts` | cross-tenant denial (warn) | 7 |
| `guards/roles.guard.ts` | role denial (warn) | 7 |
| `guards/internal-secret.guard.ts` | bad/missing secret (warn) | 7 |
| `strategies/jwt.strategy.ts` | token validation failure | 7 |
| `middleware/correlation-id.middleware.ts` | already logs `→` (P0: +org/ip ctx). Keep plain Logger. | 0 |
| `middleware/widget-cors.middleware.ts` | CORS origin rejection (warn) | 4 |
| `middleware/dashboard-cors.middleware.ts` | CORS origin rejection (warn) | 7 |
| `interceptors/logging.interceptor.ts` | already logs `←` (P3: +HTTP event write). Keep plain Logger. | 3 |
| `common/sentry/sentry.interceptor.ts` | leave (Sentry path). | — |
| `filters/all-exceptions.filter.ts` | already logs 500s (P3: +failed event write). Keep plain Logger. | 3 |

### A.6 What is deliberately NOT covered (and why)
- **GET endpoints** — no `event_logs` row (volume). They still get CONSOLE logs. (Analytics/voices/conversations reads, health.)
- **`dev-ai.controller.ts`** — dev-only module, not in prod.
- **`sentry.service.ts` / `app.service.ts`** — logging sink / trivial.
- **Raw audio bytes, full prompts, secrets, full message bodies** — redaction §5, never stored.

> **Bottom line:** all 23 controllers' mutating routes are covered automatically (AUTO); all 41 business services get CONSOLE + their relevant EVENT/3P/AUDIT layer; the 8 infra services + 13 framework files get targeted failure/fallback CONSOLE logging. Nothing is left unaccounted for.
