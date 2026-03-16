# Story 10.14: Voice Analytics & Metrics Tracking

Status: ready-for-dev

## Story

As an **agent owner**,
I want to see voice usage metrics,
So that I can understand how visitors use voice features.

## Acceptance Criteria

1. Voice messages are tagged with `inputType: 'voice'` in the ChatMessage metadata (text messages default to `'text'`)
2. Detected language is stored per voice message in metadata (`detectedLanguage`, `languageConfidence`)
3. Voice provider name and latency breakdown (sttLatencyMs, ttsLatencyMs, aiLatencyMs) stored in message metadata
4. `GET /analytics/voice-summary` returns: total voice messages, voice vs text ratio, average STT latency, average TTS latency, voice error count
5. `GET /analytics/voice/languages` returns: language distribution (count per language) for pie chart
6. `GET /analytics/voice/latency` returns: latency breakdown by provider (P50, P95, average) for STT and TTS
7. All voice analytics respect tenant isolation (CLIENT sees own org only, ADMIN/SUPER_ADMIN see all)
8. Data is filterable by date range and optional agentId
9. Voice metrics appear on the existing analytics dashboard as a new section/tab

## Tasks / Subtasks

- [ ] Task 1: Store voice metadata in ChatMessage (AC: #1, #2, #3)
  - [ ] 1.1 Update VoiceController's conversation endpoint (from 10-7) to enrich the chat message metadata
  - [ ] 1.2 When calling `ChatService.sendMessage()` for a voice message, pass additional metadata:
    ```typescript
    // The ChatService already stores metadata on the assistant message.
    // We need to also store voice-specific metadata on the USER message.
    ```
  - [ ] 1.3 After `chatService.sendMessage()` returns, update the user message's metadata with voice info:
    ```typescript
    await prisma.chatMessage.update({
      where: { id: chatResult.messageId },
      data: {
        metadata: {
          inputType: 'voice',
          detectedLanguage: sttResult.detectedLanguage,
          languageConfidence: sttResult.confidence,
          sttProvider: sttResult.provider,
          sttLatencyMs,
        },
      },
    });
    ```
  - [ ] 1.4 Update the assistant message's metadata to include TTS info:
    ```typescript
    await prisma.chatMessage.update({
      where: { id: chatResult.assistantMessageId },
      data: {
        metadata: {
          ...existingMetadata,
          inputType: 'voice',  // marks the conversation turn as voice-initiated
          ttsProvider: ttsResult?.provider,
          ttsLatencyMs,
          ttsError: ttsError ? ttsError.errorCode : null,
        },
      },
    });
    ```
  - [ ] 1.5 Text messages (from existing chat flow) don't need changes — they have no `inputType` field in metadata, which defaults to `'text'` in analytics queries

- [ ] Task 2: Create voice analytics service methods (AC: #4, #5, #6, #7, #8)
  - [ ] 2.1 Add voice analytics methods to `apps/api/src/services/analytics.service.ts` (extend existing service)
  - [ ] 2.2 Implement `getVoiceSummary(filters)`:
    ```typescript
    // Returns:
    {
      totalVoiceMessages: number;
      totalTextMessages: number;
      voiceRatio: number;          // 0.0 - 1.0
      avgSttLatencyMs: number;
      avgTtsLatencyMs: number;
      voiceErrorCount: number;
      trend: {
        voiceMessagesTrend: number;  // % change vs previous period
      };
    }
    ```
  - [ ] 2.3 Use raw SQL for efficient aggregation (same pattern as existing analytics):
    ```sql
    SELECT
      COUNT(*) FILTER (WHERE metadata->>'inputType' = 'voice') as voice_count,
      COUNT(*) FILTER (WHERE metadata->>'inputType' IS NULL OR metadata->>'inputType' = 'text') as text_count,
      AVG((metadata->>'sttLatencyMs')::numeric) FILTER (WHERE metadata->>'sttLatencyMs' IS NOT NULL) as avg_stt_latency,
      AVG((metadata->>'ttsLatencyMs')::numeric) FILTER (WHERE metadata->>'ttsLatencyMs' IS NOT NULL) as avg_tts_latency,
      COUNT(*) FILTER (WHERE metadata->>'ttsError' IS NOT NULL) as error_count
    FROM chat_messages cm
    JOIN chat_sessions cs ON cm."chatSessionId" = cs.id
    WHERE cm."createdAt" BETWEEN $1 AND $2
      AND cs."agentId" = COALESCE($3, cs."agentId")
    ```
  - [ ] 2.4 Implement `getLanguageDistribution(filters)`:
    ```typescript
    // Returns:
    { languages: Array<{ language: string; count: number; percentage: number }> }
    ```
  - [ ] 2.5 Query:
    ```sql
    SELECT
      metadata->>'detectedLanguage' as language,
      COUNT(*) as count
    FROM chat_messages cm
    JOIN chat_sessions cs ON cm."chatSessionId" = cs.id
    WHERE metadata->>'inputType' = 'voice'
      AND metadata->>'detectedLanguage' IS NOT NULL
      AND cm."createdAt" BETWEEN $1 AND $2
    GROUP BY metadata->>'detectedLanguage'
    ORDER BY count DESC
    ```
  - [ ] 2.6 Implement `getVoiceLatencyByProvider(filters)`:
    ```typescript
    // Returns:
    {
      stt: Array<{ provider: string; avg: number; p50: number; p95: number; count: number }>,
      tts: Array<{ provider: string; avg: number; p50: number; p95: number; count: number }>,
    }
    ```
  - [ ] 2.7 Use `PERCENTILE_CONT(0.5)` and `PERCENTILE_CONT(0.95)` for P50/P95 calculations
  - [ ] 2.8 Apply tenant isolation: filter by `organizationId` for CLIENT role (same pattern as existing `getSummary()`)

- [ ] Task 3: Create voice analytics API endpoints (AC: #4, #5, #6, #8)
  - [ ] 3.1 Add endpoints to existing analytics controller or create a new section:
    - `GET /analytics/voice/summary` — voice vs text ratio, avg latencies, error count
    - `GET /analytics/voice/languages` — language distribution for pie chart
    - `GET /analytics/voice/latency` — per-provider latency breakdown
  - [ ] 3.2 Accept same query params as existing analytics: `startDate`, `endDate`, `agentId` (optional)
  - [ ] 3.3 Apply `@Roles()` guard and `@UseGuards(RolesGuard)` — same as existing analytics endpoints
  - [ ] 3.4 Validate query params with Zod schema (reuse or extend existing `analyticsQuerySchema`)

- [ ] Task 4: Dashboard voice analytics section (AC: #9)
  - [ ] 4.1 Add a "Voice" tab or section to the existing analytics dashboard page
  - [ ] 4.2 Create `apps/web/components/features/analytics/voice-analytics-section.tsx`
  - [ ] 4.3 **Voice Summary Cards**: voice messages count, voice/text ratio, avg STT latency, avg TTS latency
  - [ ] 4.4 **Language Distribution Pie Chart**: using the same charting library as existing analytics (Recharts)
  - [ ] 4.5 **Provider Latency Table**: rows per provider, columns for avg/P50/P95 latency, request count
  - [ ] 4.6 Respect existing date range filter from the analytics dashboard
  - [ ] 4.7 Show empty state when no voice data exists: "No voice conversations yet. Enable voice on an agent to get started."

- [ ] Task 5: Unit tests (AC: all)
  - [ ] 5.1 Backend tests in `apps/api/test/services/analytics/`:
    - Test `getVoiceSummary` returns correct counts and ratios
    - Test `getLanguageDistribution` groups by language correctly
    - Test `getVoiceLatencyByProvider` calculates P50/P95
    - Test tenant isolation — CLIENT only sees own org's voice data
    - Test date range filtering
    - Test empty state (no voice messages) returns zeros
  - [ ] 5.2 Test voice metadata storage in voice controller tests:
    - Test user message metadata includes `inputType: 'voice'`, `detectedLanguage`, `sttProvider`
    - Test assistant message metadata includes `ttsProvider`, `ttsLatencyMs`
    - Test text messages don't have `inputType: 'voice'`

## Dev Notes

### Metadata Storage Pattern

The ChatMessage model already has a `metadata Json?` field used for response latency tracking. Voice metadata is stored in the same field:

**User message metadata (voice):**
```json
{
  "inputType": "voice",
  "detectedLanguage": "hi",
  "languageConfidence": 0.95,
  "sttProvider": "sarvam",
  "sttLatencyMs": 450
}
```

**Assistant message metadata (voice response):**
```json
{
  "backendReceivedAt": "2026-03-14T...",
  "n8nReceivedAt": "2026-03-14T...",
  "agentRepliedAt": "2026-03-14T...",
  "backendRespondedAt": "2026-03-14T...",
  "responseLatencyMs": 2100,
  "inputType": "voice",
  "ttsProvider": "sarvam",
  "ttsLatencyMs": 800,
  "ttsError": null
}
```

**User message metadata (text — unchanged):**
```json
null
```
No changes needed for text messages. Analytics queries treat `null` or missing `inputType` as `'text'`.

### Existing Analytics Query Pattern

From `analytics.service.ts`, the established pattern for raw SQL queries:

```typescript
const result = await this.prisma.$queryRaw<SomeType[]>`
  SELECT ...
  FROM chat_messages cm
  JOIN chat_sessions cs ON cm."chatSessionId" = cs.id
  JOIN agents a ON cs."agentId" = a.id
  WHERE cm."createdAt" >= ${startDate}
    AND cm."createdAt" <= ${endDate}
    ${agentId ? Prisma.sql`AND a.id = ${agentId}` : Prisma.empty}
    ${orgFilter}
`;
```

### Tenant Isolation Pattern

From existing analytics service:
```typescript
const orgFilter = role === 'CLIENT'
  ? Prisma.sql`AND a."organizationId" = ${organizationId}`
  : orgId
    ? Prisma.sql`AND a."organizationId" = ${orgId}`
    : Prisma.empty;
```

### Dashboard Integration

The analytics dashboard currently has tabs/sections. Add "Voice" as a new tab:
```
[Overview] [Conversations] [Response Times] [Message Volume] [Agents] [Voice]
```

Or as a section below existing KPI cards if the dashboard uses a single-page layout.

### No Schema Migration Needed

Voice metadata goes into the existing `metadata Json?` column on ChatMessage. No Prisma migration required — JSONB is flexible.

### What NOT to Do

- **Do NOT** create a separate table for voice analytics — use the existing ChatMessage metadata JSONB
- **Do NOT** add indexes on JSONB voice fields — the query volume doesn't justify it yet; add later if performance is a problem
- **Do NOT** implement real-time voice analytics — polling on the same interval as existing analytics is fine
- **Do NOT** add voice metrics to the per-agent table (story 8-8) — keep it in the dedicated voice section
- **Do NOT** build a voice-specific date picker — reuse the existing analytics date range filter

### Dependencies

- **Requires story 10-7** (VoiceController — stores voice metadata after conversation)
- **Requires story 10-13** (error codes — `ttsError` stored in metadata)
- Uses existing analytics service pattern (Epic 8)
- Uses existing analytics dashboard (stories 8-2 through 8-10)
- Uses Recharts for charts (already in the project from Epic 8)

### Project Structure Notes

- Analytics service: `apps/api/src/services/analytics.service.ts` (extend with voice methods)
- Analytics controller: `apps/api/src/controllers/analytics/analytics.controller.ts` (add voice endpoints)
- Voice controller: `apps/api/src/modules/voice/voice.controller.ts` (modify to store metadata)
- Dashboard component: `apps/web/components/features/analytics/voice-analytics-section.tsx` (new)
- Dashboard page: `apps/web/app/(protected)/dashboard/analytics/page.tsx` (modify to add voice tab)
- Backend tests: `apps/api/test/services/analytics/` (extend)

### References

- [Architecture: Section 20.14 - Voice Analytics](_bmad-output/planning-artifacts/architecture.md)
- [Existing analytics service](apps/api/src/services/analytics.service.ts) — query patterns
- [Existing analytics controller](apps/api/src/controllers/analytics/analytics.controller.ts) — endpoint patterns
- [Story 8-1: Analytics API Endpoints](_bmad-output/implementation-artifacts/8-1-analytics-api-endpoints.md) — full pattern reference
- [Story 10-7: Voice Controller](_bmad-output/implementation-artifacts/10-7-voice-controller-full-conversation-endpoint.md) — metadata storage point
- [Story 10-13: Error Handling](_bmad-output/implementation-artifacts/10-13-voice-error-handling-fallbacks.md) — error codes in metadata
- [ChatMessage model](apps/api/prisma/schema.prisma) — metadata JSONB column

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
