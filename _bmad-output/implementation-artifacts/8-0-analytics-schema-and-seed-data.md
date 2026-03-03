# Story 8.0: Analytics Schema Changes & Seed Data Script

Status: ready-for-dev

## Story

As a **developer**,
I want the schema extended for analytics tracking and a seed script that populates realistic data,
So that analytics queries work correctly and the dashboard can be demoed to clients.

## Acceptance Criteria

### Schema Changes

1. `ChatSource` enum is extended with `WHATSAPP` value
2. `visitorId` (String, nullable) field is added to `ChatSession` — stores IP address (web/widget) or phone number (WhatsApp)
3. Index is added on `visitorId` for unique user queries
4. Existing data is unaffected (visitorId defaults to null for old sessions)
5. Prisma migration runs cleanly on existing database

### Seed Data

6. Multiple organizations have seeded data (at least 3 orgs)
7. Each org has 2-5 agents with varied activity levels
8. ChatSessions are created with `source: 'WIDGET'` and realistic `visitorId` values across 90 days
9. ChatMessages have realistic patterns (varied `responseLatencyMs` in metadata, message lengths, hours of activity)
10. Data varies per bot (some high-volume, some low, different peak hours)
11. Returning visitors are seeded (same `visitorId` across multiple sessions for retention KPI)
12. Script is idempotent (safe to re-run, cleans up previous seed data with a marker)
13. Script is runnable via `bun run seed:analytics`

## Tasks / Subtasks

- [ ] Task 1: Prisma schema changes (AC: 1-5)
  - [ ] 1.1 Add `WHATSAPP` to `ChatSource` enum in `apps/api/prisma/schema.prisma`
  - [ ] 1.2 Add `visitorId String?` field to `ChatSession` model
  - [ ] 1.3 Add `@@index([visitorId])` to `ChatSession`
  - [ ] 1.4 Run `bunx prisma migrate dev --name add-visitor-id-and-whatsapp-source`
  - [ ] 1.5 Run `bunx prisma generate` to update client

- [ ] Task 2: Create analytics seed script (AC: 6-13)
  - [ ] 2.1 Create `apps/api/prisma/seed-analytics.ts`
  - [ ] 2.2 Add `"seed:analytics"` script to `apps/api/package.json`: `"bunx tsx prisma/seed-analytics.ts"`
  - [ ] 2.3 Implement seed data cleanup (delete all ChatMessages/ChatSessions where a seeded marker exists)
  - [ ] 2.4 Implement org + agent lookup (seed against EXISTING orgs and agents — do NOT create new ones)
  - [ ] 2.5 Implement session generation across 90 days with realistic patterns
  - [ ] 2.6 Implement message generation with varied `responseLatencyMs` metadata
  - [ ] 2.7 Implement returning visitor patterns (reuse visitorId across sessions)
  - [ ] 2.8 Add `bun run seed:analytics` to root `package.json` as turbo task

- [ ] Task 3: Unit tests for seed script (AC: 12)
  - [ ] 3.1 Test idempotency — running twice produces same result
  - [ ] 3.2 Test cleanup — previous seeded data is removed before re-seeding

## Dev Notes

### Schema Change Details

**File:** `apps/api/prisma/schema.prisma`

Current `ChatSource` enum:
```prisma
enum ChatSource {
  DEMO
  WIDGET
}
```

Change to:
```prisma
enum ChatSource {
  DEMO
  WIDGET
  WHATSAPP
}
```

Current `ChatSession` model — add `visitorId`:
```prisma
model ChatSession {
  id            String        @id @default(uuid())
  agentId       String
  agent         Agent         @relation(fields: [agentId], references: [id])
  sessionId     String        @unique
  source        ChatSource    @default(DEMO)
  visitorId     String?       // IP address (web/widget) or phone number (WhatsApp)
  status        SessionStatus @default(ACTIVE)
  messages      ChatMessage[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  lastMessageAt DateTime?

  @@index([agentId])
  @@index([source])
  @@index([visitorId])
  @@map("chat_sessions")
}
```

### Seed Script Architecture

**Seeded data marker:** Use a specific `sessionId` prefix like `seed-analytics-` so the cleanup step can identify and remove seeded data without touching real data.

**Data generation strategy:**
- Look up existing organizations via `prisma.organization.findMany()`
- Look up existing agents via `prisma.agent.findMany()` for each org
- If no orgs/agents exist, log a warning and exit (don't create fake orgs/agents — that's a different concern)
- Generate 90 days of data working backwards from today
- Per-agent variation:
  - High-volume bot: 20-50 sessions/day, 5-15 messages per session
  - Medium-volume bot: 5-15 sessions/day, 3-8 messages per session
  - Low-volume bot: 1-5 sessions/day, 2-5 messages per session
- Response latency variation:
  - Fast bot: 200-800ms average
  - Medium bot: 500-2000ms average
  - Slow bot: 1000-5000ms average
- Activity hour patterns: weight sessions toward business hours (9am-6pm) with some 24/7 activity
- Visitor retention: ~30% of `visitorId` values should appear in multiple sessions across different days

**Message content:** Use realistic placeholder messages — user questions about products, pricing, support. Bot responses with typical AI assistant language. Vary message lengths (short queries vs detailed responses).

**Metadata format** (must match existing `buildMetadata()` in `chat.service.ts`):
```json
{
  "backendReceivedAt": "2026-01-15T10:30:00.000Z",
  "n8nReceivedAt": null,
  "agentRepliedAt": null,
  "backendRespondedAt": "2026-01-15T10:30:01.200Z",
  "responseLatencyMs": 1200
}
```

### Project Structure Notes

- Schema: `apps/api/prisma/schema.prisma`
- Migration output: `apps/api/prisma/migrations/`
- Seed script: `apps/api/prisma/seed-analytics.ts` (new file)
- Package scripts: `apps/api/package.json` (add seed:analytics)
- Root turbo script: `package.json` (add seed:analytics passthrough)

### References

- [Source: apps/api/prisma/schema.prisma] — ChatSession model, ChatSource enum
- [Source: apps/api/src/services/chat.service.ts#L20-L32] — buildMetadata() format for responseLatencyMs
- [Source: _bmad-output/implementation-artifacts/epic-8-deferred-kpis.md] — Deferred KPIs documentation
- [Source: _bmad-output/planning-artifacts/architecture.md] — Database schema section, ADR-008 hybrid analytics

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
