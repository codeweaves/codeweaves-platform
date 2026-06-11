# Message Metrics → Dedicated Columns (migration plan)

**Goal:** stop storing analytics metrics in the loose `chat_messages.metadata` JSONB (where 9 write
paths drifted into inconsistent key names and silently broke analytics) and move them into a typed,
dedicated table written through a single normalizing writer. Old data is **backfilled, not lost.**

**Why a separate `chat_message_metrics` table (not columns on `chat_messages`):** the message row is
read constantly to render chat history, and Prisma loads all scalar columns by default — bolting ~40
metric columns onto it would bloat every history fetch. A 1:1 side table keeps the hot path lean and
gives analytics a clean table to index. (Decision #1 — confirm.)

---

## 1. Canonical schema — `chat_message_metrics` (1:1 with `chat_messages`)

```prisma
model ChatMessageMetrics {
  messageId   String   @id            // FK -> chat_messages.id, ON DELETE CASCADE
  createdAt   DateTime                // copy of the message's createdAt (immutable) for time-scoped analytics without a 2nd join

  // ---- channel / mode ---- (n8n is retired; everything is direct, so no routingMode)
  inputType   String?                 // 'text' | 'voice'
  streamed    Boolean?                // was the reply streamed (vs buffered/sync)?

  // ---- backend / LLM timing (ms) ----
  responseLatencyMs   Int?            // backend wall-clock: received -> responded
  llmLatencyMs        Int?            // LLM generation wall-clock only
  timeToFirstTokenMs  Int?            // LLM time-to-first-token
  timeToLastTokenMs   Int?
  streamDurationMs    Int?            // n8n stream window
  totalChunks         Int?
  backendReceivedAt   DateTime?
  backendRespondedAt  DateTime?

  // ---- LLM cost / tokens (direct mode) ----
  model            String?
  traceId          String?
  costUsd          Decimal? @db.Decimal(12, 6)
  inputTokens      Int?
  outputTokens     Int?
  totalTokens      Int?
  cachedInputTokens Int?
  reasoningTokens  Int?
  finishReason     String?
  historyCount     Int?
  historyTruncated Boolean?

  // ---- STT (voice input / USER message) ----
  sttProvider        String?
  sttLatencyMs       Int?
  detectedLanguage   String?
  languageConfidence Decimal? @db.Decimal(4, 3)

  // ---- TTS (voice reply / ASSISTANT message) ----
  ttsProvider           String?       // NEW — captured going forward (Sarvam / ElevenLabs / ...)
  ttsProtocol           String?       // 'http' | 'websocket' | 'mixed'
  ttsLatencyMs          Int?          // avg per-sentence TTS synth latency
  timeToFirstAudioMs    Int?          // user hears first audio (TTFA)
  voiceTotalLatencyMs   Int?          // full STT->TTS round trip
  totalSentences        Int?
  wsAvgFirstChunkLatencyMs Int?
  wsTotalChunks         Int?
  wsTotalBytes          Int?

  // ---- WhatsApp ----
  waInboundId  String?
  waOutboundId String?
  delivered    Boolean?
  replyMode    String?                // 'text' | 'voice'

  // ---- errors ----
  errored   Boolean?
  errorCode String?

  message ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([createdAt])
  @@index([sttProvider])
  @@index([ttsProvider])
  @@map("chat_message_metrics")
}
```

---

## 2. Alias → column map (THE review focus)

Different pipelines named the same metric differently. Backfill `COALESCE`s across all aliases into
one canonical column. ✅ = safe merge (same meaning). ⚠️ = judgment call, please confirm.

| Canonical column | Backfilled from these JSON keys | Note |
|---|---|---|
| `timeToFirstTokenMs` | `timeToFirstToken` (text) · `llmTtftMs` (voice) · `ttftMs` (dev) | ✅ all = LLM TTFT |
| `ttsLatencyMs` | `averageTtsLatencyMs` (current) · `ttsLatencyMs` (old March) | ✅ same |
| `timeToFirstAudioMs` | `timeToFirstChunkMs` | ✅ rename |
| `llmLatencyMs` | `llmLatencyMs` (voice) · `latencyMs` (dev) · `responseLatencyMs` (WhatsApp old) | the AI's generation time. WhatsApp's old `responseLatencyMs` key actually held this. |
| `responseLatencyMs` | `responseLatencyMs` (text/widget only) | backend: user msg received → reply sent. Old WhatsApp rows have no true value here → left null; measured properly going forward. |
| `streamed` | true on streaming paths / when `totalChunks` is set; false on sync | n8n's old `real`/`simulated` only matter for old rows |
| `ttsProvider` | `ttsProvider` (old only) | recent rows = null until pipeline starts tagging it |
| `errored` | `error` (voice) | ✅ |
| all others (`model`,`cost`,tokens,`traceId`,`sttProvider`,`sttLatencyMs`,`detectedLanguage`,`languageConfidence`,`finishReason`,`historyCount`,`historyTruncated`,`totalSentences`,`ttsProtocol`,`ws*`,`backend*At`,`n8n*`,`agentRepliedAt`,`wa*`,`delivered`,`replyMode`) | same-named key | ✅ direct copy |

`cost` (JSON) → `costUsd` (column) is a rename for clarity.

---

## 3. Backfill — preserve old data, prove zero loss

- One `INSERT INTO chat_message_metrics SELECT ... FROM chat_messages` with the COALESCE map above.
- **Safe casts:** numeric pulls guarded (`CASE WHEN metadata->>'k' ~ '^[0-9]+(\.[0-9]+)?$' THEN (…)::int END`) so a junk value can't crash the migration.
- **Verification (run before declaring done):** for each metric, assert
  `count(rows with the metric under ANY alias in JSON) == count(rows with the column populated)`.
  Report a per-metric table; investigate any mismatch before proceeding.
- ~30k rows today → seconds. (This is *why* we do it now, not at millions of rows.)

## 4. Single writer — kills future drift

`MessageMetricsService.record(messageId, metrics: MessageMetricsInput)`:
- `MessageMetricsInput` is a strict typed object (no index signature). Adding a metric = a deliberate
  schema change, reviewed.
- Each channel maps its provider outputs into this shape at the adapter boundary, then calls `record()`.
  Providers' raw metric names are normalized here, once.

## 5. Per-channel population (who fills what)

Only these live channels are wired through the writer (n8n retired; dev/demo stays JSON-only):

| Channel | fills |
|---|---|
| Text/widget (stream + sync) | `responseLatencyMs` + LLM TTFT/latency + cost/tokens |
| Voice | STT (user msg) + TTS + LLM |
| WhatsApp | `llmLatencyMs` + cost/tokens + `wa*` + `delivered`; `responseLatencyMs` once we measure received→sent |

## 6. Decisions (resolved 2026-06-11)
1. **Separate `chat_message_metrics` table.** ✅
2. **`llmLatencyMs` (AI generation time) and `responseLatencyMs` (received→reply-sent) are distinct columns.** WhatsApp's old latency value was actually the AI's time → backfills into `llmLatencyMs`; old WhatsApp `responseLatencyMs` stays null (never measured), measured properly going forward. "Visible/delivered on recipient's phone" is a separate future metric via delivery receipts (`delivered`/`waOutboundId` already stored).
3. **n8n is retired** — no `routingMode` column (everything is direct); n8n-only timestamps (`n8nReceivedAt`/`agentRepliedAt`) not carried over. Old n8n rows still backfill their universal metrics (latency, chunks, TTFT). Removing the n8n **code** is a separate cleanup epic, not part of this migration.
4. **Keep the `metadata` JSON column** until data is transferred + verified (likely keep long-term for debug).
5. **Dev/demo path left JSON-only** (test traffic, not customer analytics).

## 7. Rollout order
migration → backfill+verify → writer → wire channels (+ttsProvider capture) → rewrite analytics → tests → full verify. Branch `feature/message-metrics-columns`.
