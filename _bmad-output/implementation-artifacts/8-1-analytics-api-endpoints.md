# Story 8.1: Analytics API Endpoints

Status: done

## Story

As a **dashboard**,
I want API endpoints for analytics data,
So that I can fetch and display metrics.

## Acceptance Criteria

### Summary Endpoint

1. **Given** authenticated user with valid organization, **When** calling `GET /api/analytics/summary?startDate=X&endDate=Y`, **Then** KPI summary data is returned for the 10 buildable KPIs
2. Super Admin/Admin users see all orgs by default (can filter by `orgId` query param)
3. Client users see only their organization's data (orgId filter ignored)
4. Date range query params `startDate` and `endDate` are respected (ISO 8601 format)
5. Optional `agentId` query param scopes metrics to a specific bot
6. Response includes trend data (% change vs previous equivalent period)
7. Cache headers: `Cache-Control: private, max-age=300` (5 min client caching)

### Chart Endpoints

8. `GET /api/analytics/charts/conversations` — returns daily conversation counts for the date range
9. `GET /api/analytics/charts/response-times` — returns response time distribution buckets (<1s, 1-2s, 2-5s, 5-10s, >10s) with counts and percentages
10. `GET /api/analytics/charts/message-volume` — returns hourly message volume data (day x hour grid for heatmap)

### Agent Table Endpoint

11. `GET /api/analytics/agents` — returns per-agent metrics (conversations, messages, avg response time, queries raised) with sorting and pagination

### Cross-Cutting

12. All endpoints validate input with Zod schemas from `packages/validation`
13. All endpoints respect tenant isolation via `buildTenantFilter` pattern or equivalent role-based logic
14. All endpoints return proper error responses (400, 401, 403, 404)
15. Unit tests for analytics controller and service

## Tasks / Subtasks

- [x] Task 1: Create analytics module structure (AC: 12-14)
  - [x] 1.1 Create `apps/api/src/modules/analytics.module.ts`
  - [x] 1.2 Create `apps/api/src/controllers/analytics/analytics.controller.ts`
  - [x] 1.3 Create `apps/api/src/services/analytics.service.ts`
  - [x] 1.4 Register module in `apps/api/src/modules/app.module.ts`

- [x] Task 2: Create validation schemas (AC: 4-5, 12)
  - [x] 2.1 Create `packages/validation/src/analytics.ts` with:
    - `analyticsQuerySchema` (startDate, endDate, agentId?, orgId?)
    - `agentAnalyticsQuerySchema` (extends paginationSchema + analyticsQuerySchema + sortBy, sortOrder)
  - [x] 2.2 Export from `packages/validation/src/index.ts`

- [x] Task 3: Implement analytics service (AC: 1-11)
  - [x] 3.1 Implement `getSummary()` — query ChatSession + ChatMessage for 10 KPIs:
    - Total Users: `COUNT(DISTINCT visitorId)` on ChatSession, split new vs returning (first session vs subsequent)
    - Total Conversations: `COUNT(*)` on ChatSession
    - Total Messages Sent: `COUNT(*)` on ChatMessage where role = USER
    - Total Messages Received: `COUNT(*)` on ChatMessage where role = ASSISTANT
    - Message Volume Trends: Group by date, count messages
    - User Retention Rate: `visitorId` that appear in sessions more than 60 days apart / total unique visitors
    - User Growth Rate: new unique `visitorId` this period vs previous period
    - % Change in New Users: delta of new users period-over-period
    - Avg Response Time: `AVG(metadata->>'responseLatencyMs')` on assistant messages, plus P50/P95/P99
    - Queries Raised: same as total messages sent (user messages)
  - [x] 3.2 Implement `getConversationsChart()` — daily session counts grouped by date
  - [x] 3.3 Implement `getResponseTimeDistribution()` — bucket assistant messages by responseLatencyMs
  - [x] 3.4 Implement `getMessageVolumeHeatmap()` — group messages by day-of-week and hour
  - [x] 3.5 Implement `getAgentMetrics()` — per-agent aggregation with pagination and sorting
  - [x] 3.6 Implement trend calculation — run same queries for previous period and compute % change

- [x] Task 4: Implement analytics controller (AC: 1-11, 14)
  - [x] 4.1 `GET /analytics/summary` — calls `getSummary()`, sets cache headers
  - [x] 4.2 `GET /analytics/charts/conversations` — calls `getConversationsChart()`
  - [x] 4.3 `GET /analytics/charts/response-times` — calls `getResponseTimeDistribution()`
  - [x] 4.4 `GET /analytics/charts/message-volume` — calls `getMessageVolumeHeatmap()`
  - [x] 4.5 `GET /analytics/agents` — calls `getAgentMetrics()`
  - [x] 4.6 Apply `@UseGuards(RolesGuard)` and `@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)` on controller
  - [x] 4.7 Set `Cache-Control: private, max-age=300` response header on all endpoints

- [x] Task 5: Unit tests (AC: 15)
  - [x] 5.1 Create `apps/api/test/controllers/analytics/analytics.controller.spec.ts`
  - [x] 5.2 Create `apps/api/test/services/analytics/analytics.service.spec.ts`
  - [x] 5.3 Test tenant isolation: CLIENT user only sees own org data
  - [x] 5.4 Test ADMIN/SUPER_ADMIN sees all data, can filter by orgId
  - [x] 5.5 Test date range filtering
  - [x] 5.6 Test agentId filtering
  - [x] 5.7 Test error cases (invalid dates, missing auth)

## Dev Notes

### Role-Based Access Pattern

Follow the exact pattern from `AgentsService.findAll()`:

```typescript
// In analytics service methods
const agentFilter: Prisma.AgentWhereInput = {
  deletedAt: null,
  ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
  ...(user.role !== Role.CLIENT && query.orgId && { organizationId: query.orgId }),
  ...(query.agentId && { id: query.agentId }),
};

// Get agent IDs first, then filter sessions
const agents = await this.prisma.agent.findMany({ where: agentFilter, select: { id: true } });
const agentIds = agents.map(a => a.id);

// Query sessions scoped to these agents
const sessions = await this.prisma.chatSession.findMany({
  where: {
    agentId: { in: agentIds },
    createdAt: { gte: startDate, lte: endDate },
  },
});
```

### Querying responseLatencyMs from JSONB metadata

ChatMessage `metadata` is a Prisma `Json?` field. To query responseLatencyMs:

```typescript
// Use Prisma raw query for aggregation on JSONB field
const result = await this.prisma.$queryRaw`
  SELECT
    AVG((metadata->>'responseLatencyMs')::numeric) as avg_response_ms,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p99
  FROM chat_messages
  WHERE role = 'ASSISTANT'
    AND metadata->>'responseLatencyMs' IS NOT NULL
    AND chat_session_id IN (
      SELECT id FROM chat_sessions WHERE agent_id = ANY(${agentIds})
      AND created_at >= ${startDate} AND created_at <= ${endDate}
    )
`;
```

### Response Shape

```typescript
// GET /analytics/summary response
{
  period: { start: string, end: string },
  kpis: {
    totalUsers: { value: number, trend: number }, // trend is % change
    newUsers: { value: number, trend: number },
    returningUsers: { value: number, trend: number },
    totalConversations: { value: number, trend: number },
    totalMessagesSent: { value: number, trend: number },
    totalMessagesReceived: { value: number, trend: number },
    totalMessagesExchanged: { value: number, trend: number },
    userRetentionRate: { value: number, trend: number }, // percentage
    userGrowthRate: { value: number, trend: number }, // percentage
    avgResponseTimeMs: { value: number, trend: number },
    p50ResponseTimeMs: { value: number },
    p95ResponseTimeMs: { value: number },
    p99ResponseTimeMs: { value: number },
    queriesRaised: { value: number, trend: number },
  }
}

// GET /analytics/charts/conversations response
{
  data: [{ date: string, count: number }]
}

// GET /analytics/charts/response-times response
{
  buckets: [
    { label: "<1s", min: 0, max: 1000, count: number, percentage: number },
    { label: "1-2s", min: 1000, max: 2000, count: number, percentage: number },
    // ...
  ],
  percentiles: { p50: number, p95: number, p99: number }
}

// GET /analytics/charts/message-volume response
{
  data: [{ day: number, hour: number, count: number }] // day 0=Sun, hour 0-23
}

// GET /analytics/agents response
{
  data: [{ agentId, agentName, conversations, messages, avgResponseTimeMs, queriesRaised }],
  meta: { page, limit, total, totalPages }
}
```

### Project Structure Notes

- New module: `apps/api/src/modules/analytics.module.ts`
- New controller: `apps/api/src/controllers/analytics/analytics.controller.ts`
- New service: `apps/api/src/services/analytics.service.ts`
- New validation: `packages/validation/src/analytics.ts`
- Tests: `apps/api/test/controllers/analytics/analytics.controller.spec.ts`
- Tests: `apps/api/test/services/analytics/analytics.service.spec.ts`
- Register in: `apps/api/src/modules/app.module.ts`

### References

- [Source: apps/api/src/services/agents.service.ts] — Tenant isolation pattern (findAll with role-based where clause)
- [Source: apps/api/src/utils/tenant-filter.ts] — buildTenantFilter utility
- [Source: apps/api/src/controllers/agents/agents.controller.ts] — Controller pattern with RolesGuard, Zod validation
- [Source: apps/api/src/services/chat.service.ts#L20-L32] — metadata format with responseLatencyMs
- [Source: packages/validation/src/index.ts] — Validation schema patterns (paginationSchema, etc.)
- [Source: apps/api/prisma/schema.prisma] — ChatSession, ChatMessage models

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed circular import in `packages/validation/src/analytics.ts` — inlined pagination fields instead of importing from `./index.js`
- Fixed `import { Response }` → `import type { Response }` for express (jest module resolution)
- Fixed lint warnings: removed unused `clientUser`, `orderSql`, replaced `as any` with `as unknown as Response`
- Fixed strict TS array access (`data[0]` → `data[0]!`) for possibly undefined checks

### Code Review Fixes (Adversarial Review)
- **#1 HIGH**: Removed redundant `new Date()` wrapping — query params are already Date objects from Zod
- **#2 HIGH**: Parallelized all getSummary queries into single `Promise.all` (7→1 sequential round-trips)
- **#3 MEDIUM**: Replaced in-memory session/message loading with SQL aggregation (`$queryRaw` with COUNT/DISTINCT/FILTER)
- **#4 MEDIUM**: Combined response time distribution + percentiles into single CTE-based query
- **#5 MEDIUM**: Added real trend calculation for `userRetentionRate` (scoped by endDate, compares periods)
- **#6 MEDIUM**: Added composite index `@@index([chatSessionId, role])` on chat_messages for analytics queries
- **#7 LOW**: Replaced `Infinity` with `null` in last bucket max to avoid JSON serialization issue
- **#8 LOW**: Inline tenant filter accepted — matches AgentsService pattern per story dev notes
- Removed unused `Logger` import and field from analytics service

### Completion Notes List
- All 5 analytics API endpoints implemented: summary, conversations chart, response-time distribution, message-volume heatmap, per-agent metrics
- Tenant isolation follows exact pattern from AgentsService.findAll() — CLIENT scoped to org, ADMIN/SUPER_ADMIN see all
- Trend calculation computes % change vs previous equivalent period for all KPIs including retention rate
- Raw SQL used for all aggregation (session metrics, message metrics, JSONB responseLatencyMs, retention rate, agent metrics)
- Zod validation schemas with date coercion, UUID validation, and startDate <= endDate refinement
- Cache-Control: private, max-age=300 set on all endpoints
- 45 unit tests (22 controller + 23 service) covering all ACs
- 791 total tests pass, 0 regressions

### File List
- `apps/api/src/modules/analytics.module.ts` (new)
- `apps/api/src/controllers/analytics/analytics.controller.ts` (new)
- `apps/api/src/services/analytics.service.ts` (new)
- `apps/api/src/models/analytics.dto.ts` (new)
- `apps/api/src/modules/app.module.ts` (modified — added AnalyticsModule import)
- `apps/api/prisma/schema.prisma` (modified — added composite index on chat_messages)
- `packages/validation/src/analytics.ts` (new)
- `packages/validation/src/index.ts` (modified — added analytics re-export)
- `apps/api/test/controllers/analytics/analytics.controller.spec.ts` (new)
- `apps/api/test/services/analytics/analytics.service.spec.ts` (new)
