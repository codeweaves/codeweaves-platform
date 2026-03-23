# Story 13.5: Streaming Metadata Extraction & Analytics

Status: ready-for-dev

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
6. `streamingMode` is set to `"real"` or `"simulated"` in message metadata
7. All new metrics are stored in the ChatMessage `metadata` JSON column alongside existing fields
8. Existing analytics queries continue to work (backward compatible — new fields are additive)
9. Analytics API endpoints return streaming metrics when available
10. Unit tests verify metadata extraction for both streaming modes

## Tasks / Subtasks

- [ ] Task 1: Define StreamingMetadata interface (AC: 1-6)
  - [ ] Create or extend metadata type in `apps/api/src/services/chat-metadata.interface.ts`
  - [ ] Include all fields: `backendReceivedAt`, `n8nReceivedAt`, `agentRepliedAt`, `backendRespondedAt`, `responseLatencyMs`, `streamingMode`, `timeToFirstToken`, `totalTokens`, `streamDurationMs`

- [ ] Task 2: Build metadata in real streaming path (AC: 1-6, 7)
  - [ ] In `PublicChatController.handleRealStreaming()` (from Story 13-4), collect timestamps during iteration
  - [ ] After stream ends, build full metadata object with all fields
  - [ ] Store in assistant ChatMessage metadata column

- [ ] Task 3: Add streamingMode to simulated path (AC: 6, 8)
  - [ ] In `ChatService.buildMetadata()`, add `streamingMode: 'simulated'` field
  - [ ] Existing fields unchanged — purely additive

- [ ] Task 4: Update analytics aggregation (AC: 8, 9)
  - [ ] Check existing analytics queries in `apps/api/src/services/analytics.service.ts`
  - [ ] Ensure response time calculations work with both metadata shapes
  - [ ] Add `streamingMode` to any per-message analytics breakdowns if applicable
  - [ ] Add `averageTimeToFirstToken` to analytics summary if useful

- [ ] Task 5: Unit tests (AC: 10)
  - [ ] Test metadata built from real streaming: all fields present with correct values
  - [ ] Test metadata built from simulated streaming: `streamingMode: 'simulated'`, no streaming-specific fields
  - [ ] Test backward compatibility: existing analytics queries handle both shapes
  - [ ] Test null handling: missing timestamps in n8n chunks → null in metadata

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

### New Metadata Shape (Real Streaming)

```typescript
{
  // Existing fields (same meaning, different source)
  backendReceivedAt: "2026-03-01T10:00:00.000Z",
  n8nReceivedAt: "2026-03-01T10:00:00.701Z",       // from begin chunk metadata.timestamp
  agentRepliedAt: "2026-03-01T10:00:02.355Z",       // from end chunk metadata.timestamp
  backendRespondedAt: "2026-03-01T10:00:02.400Z",
  responseLatencyMs: 2400,

  // New streaming-specific fields
  streamingMode: "real",
  timeToFirstToken: 750,                             // ms from request sent to first item chunk
  totalTokens: 47,                                   // count of item chunks
  streamDurationMs: 1654,                            // end timestamp - begin timestamp
}
```

### New Metadata Shape (Simulated — Backward Compatible)

```typescript
{
  // Existing fields (unchanged)
  backendReceivedAt: "...",
  n8nReceivedAt: "...",
  agentRepliedAt: "...",
  backendRespondedAt: "...",
  responseLatencyMs: 1300,

  // New field only
  streamingMode: "simulated",
  // timeToFirstToken, totalTokens, streamDurationMs are NOT present
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

### Completion Notes List

### Change Log

### File List
