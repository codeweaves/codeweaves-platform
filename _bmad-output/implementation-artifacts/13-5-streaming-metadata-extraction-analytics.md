# Story 13.5: Streaming Metadata Extraction & Analytics

Status: done

## Story

As a **platform operator**,
I want accurate latency metrics from the streaming pipeline,
So that I can monitor AI response times and diagnose bottlenecks.

## Acceptance Criteria

1. `n8nReceivedAt` is extracted from the `begin` chunk's `metadata.timestamp`
2. `agentRepliedAt` is extracted from the `end` chunk's `metadata.timestamp`
3. `timeToFirstToken` is calculated (first `item` chunk arrival time - request sent time)
4. `streamDurationMs` is calculated (`end` timestamp - `begin` timestamp)
5. `totalTokens` counts the number of `item` chunks received
6. All new metrics are stored in the ChatMessage `metadata` JSON column alongside existing fields (additive)
7. Existing analytics queries continue to work (new fields are additive)
8. Analytics API endpoints return streaming metrics when available
9. Unit tests verify metadata extraction from stream chunks

## Tasks / Subtasks

- [x] Task 1: Define StreamingMetadata interface (AC: 1-5)
  - [x] Create or extend metadata type in `apps/api/src/services/chat-metadata.interface.ts`
  - [x] Include all fields: `backendReceivedAt`, `n8nReceivedAt`, `agentRepliedAt`, `backendRespondedAt`, `responseLatencyMs`, `timeToFirstToken`, `timeToLastToken`, `totalTokens`, `streamDurationMs`

- [x] Task 2: Build metadata in streaming path (AC: 1-5, 6)
  - [x] In `PublicChatController.handleStreaming()` (from Story 13-4), collect timestamps during iteration
  - [x] After stream ends, build full metadata object with all fields
  - [x] Store in assistant ChatMessage metadata column

- [x] Task 3: Update analytics aggregation (AC: 7, 8)
  - [x] Check existing analytics queries in `apps/api/src/services/analytics.service.ts`
  - [x] Ensure response time calculations work with the new metadata shape
  - [x] Add `averageTimeToFirstToken` to analytics summary if useful

- [x] Task 4: Unit tests (AC: 9)
  - [x] Test metadata built from streaming: all fields present with correct values
  - [x] Test backward compatibility: existing analytics queries handle new fields
  - [x] Test null handling: missing timestamps in n8n chunks → null in metadata

## Dev Notes

### Current Metadata Shape

`ChatService.buildMetadata()` (`chat.service.ts`, lines 26-38):
```typescript
{
  backendReceivedAt: "2026-03-01T10:00:00.000Z",
  n8nReceivedAt: "2026-03-01T10:00:00.500Z",      // from n8n response payload
  agentRepliedAt: "2026-03-01T10:00:01.200Z",      // from n8n response payload
  backendRespondedAt: "2026-03-01T10:00:01.300Z",
  responseLatencyMs: 1300,
}
```

### New Metadata Shape (Streaming)

```typescript
{
  // Existing fields (same meaning, now sourced from stream chunks)
  backendReceivedAt: "2026-03-01T10:00:00.000Z",
  n8nReceivedAt: "2026-03-01T10:00:00.701Z",       // from begin chunk metadata.timestamp
  agentRepliedAt: "2026-03-01T10:00:02.355Z",       // from end chunk metadata.timestamp
  backendRespondedAt: "2026-03-01T10:00:02.400Z",
  responseLatencyMs: 2400,

  // New streaming-specific fields
  timeToFirstToken: 750,                             // ms from request sent to first item chunk
  totalTokens: 47,                                   // count of item chunks
  streamDurationMs: 1654,                            // end timestamp - begin timestamp
}
```

### Timestamp Source Mapping

| Metric | Legacy (Webhook) | Real Streaming (Chat Trigger) |
|--------|-----------------|-------------------------------|
| `n8nReceivedAt` | `response.payload.n8nReceivedAt` | `beginChunk.metadata.timestamp` (epoch ms → ISO) |
| `agentRepliedAt` | `response.payload.agentRepliedAt` | `endChunk.metadata.timestamp` (epoch ms → ISO) |
| `timeToFirstToken` | N/A | `firstItemChunkArrival - fetchStartTime` (ms) |
| `totalTokens` | N/A | Count of `item` chunks |
| `streamDurationMs` | N/A | `endTimestamp - beginTimestamp` (ms) |

### Analytics Service Impact

Check `apps/api/src/services/analytics.service.ts` for queries that use `metadata.responseLatencyMs`, `metadata.n8nReceivedAt`, or `metadata.agentRepliedAt`. These fields exist in both shapes, so queries should work. The new fields are purely additive.

If any analytics endpoint computes average response time, it should continue using `responseLatencyMs` (present in both modes).

### Relationship to Story 13-4

Story 13-4 builds the metadata object in the controller's real streaming path. This story (13-5) formalizes the interface, ensures simulated path also reports `streamingMode`, and verifies analytics compatibility. If 13-4 and 13-5 are developed together, the metadata logic from 13-4 should use the interface defined here.

### Dependencies

- **Story 13-4**: Real streaming controller path must exist (metadata is built there)
- Can be developed in parallel with 13-4 if the interface is defined first

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/api/src/services/chat-metadata.interface.ts` | CREATE — StreamingMetadata interface |
| `apps/api/src/services/chat.service.ts` | MODIFY — add `streamingMode: 'simulated'` to `buildMetadata()` |
| `apps/api/src/controllers/public/public-chat.controller.ts` | VERIFY — metadata built correctly in real streaming path (from 13-4) |
| `apps/api/src/services/analytics.service.ts` | VERIFY — queries handle both metadata shapes |
| `apps/api/test/services/chat/chat-metadata.spec.ts` | CREATE — metadata extraction tests |
| `apps/api/test/services/chat/chat.service.spec.ts` | MODIFY — verify simulated path includes streamingMode |

### References

- [Source: architecture.md#Section 12.3] — Metadata extraction mapping table
- [Source: architecture.md#Section 20.14.4] — Voice metadata extraction (same pattern)
- [Source: chat.service.ts#26-38] — Current buildMetadata() method
- [Source: chat.service.ts#305-308] — Current n8n response metadata fields

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- Created `ChatMessageMetadata` type system with `BaseChatMetadata`, `SimulatedStreamingMetadata`, `RealStreamingMetadata`, and `DirectMetadata` types. All share base fields (`responseLatencyMs`, `n8nReceivedAt`, `agentRepliedAt`) so analytics queries work across all modes.
- Added `streamingMode: 'simulated'` to `ChatService.buildMetadata()` (webhook/simulated SSE paths) and `streamingMode: 'real'` to the controller's real streaming path.
- Added `timeToLastToken` field — ms from request to last item chunk arrival, giving end-to-end streaming completion time from backend's perspective.
- Kept field name as `totalChunks` (counts SSE chunks, not LLM tokens — renaming to `totalTokens` per AC5 was reverted during code review as misleading).
- Added `avgTimeToFirstTokenMs` KPI to analytics summary endpoint — aggregates `timeToFirstToken` from streaming metadata when available.
- All existing analytics queries verified compatible — they use `responseLatencyMs`, `n8nReceivedAt`, `agentRepliedAt` which are in `BaseChatMetadata`.
- 11 new tests in `chat-metadata.spec.ts` covering interface shapes, null handling, backward compatibility, and metadata extraction from stream chunks.
- Updated existing `chat.service.spec.ts` (2 assertions for `streamingMode: 'simulated'`) and `public-chat.controller.spec.ts` (field rename).

### Change Log
- 2026-03-23: Implemented streaming metadata extraction & analytics (Story 13-5)
- 2026-03-23: Code review fixes — added avgTimeToFirstTokenMs trend, reverted buildMetadata to private, added return type to getResponseTimeMetrics, renamed totalTokens back to totalChunks

### File List
- `apps/api/src/services/chat-metadata.interface.ts` (NEW) — BaseChatMetadata, SimulatedStreamingMetadata, RealStreamingMetadata type definitions
- `apps/api/src/services/chat.service.ts` (MODIFIED) — private `buildMetadata()` returns `SimulatedStreamingMetadata` with `streamingMode: 'simulated'`
- `apps/api/src/controllers/public/public-chat.controller.ts` (MODIFIED) — typed metadata as `RealStreamingMetadata` with `streamingMode: 'real'`, added `timeToLastToken`, `totalChunks`
- `apps/api/src/services/analytics.service.ts` (MODIFIED) — added `avgTimeToFirstTokenMs` KPI with trend to summary, typed `getResponseTimeMetrics` return
- `apps/api/test/services/chat/chat-metadata.spec.ts` (NEW) — 11 metadata interface/extraction tests
- `apps/api/test/services/chat/chat.service.spec.ts` (MODIFIED) — added `streamingMode: 'simulated'` assertions
- `apps/api/test/controllers/public/public-chat.controller.spec.ts` (MODIFIED) — updated metadata field assertions
