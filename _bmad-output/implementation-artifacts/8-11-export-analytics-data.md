# Story 8.11: Export Analytics Data

Status: done

## Story

As an **agent owner**,
I want to export my analytics data,
So that I can analyze it in external tools.

## Acceptance Criteria

1. **Given** analytics data is displayed, **When** I click "Export" button, **Then** a dropdown shows format options (CSV, JSON)
2. Export includes all visible data for the selected date range
3. CSV export contains: KPI summary + per-agent metrics as separate sections
4. JSON export contains: full API response data (summary + agents)
5. File downloads with descriptive filename: `analytics-{orgName}-{startDate}-{endDate}.{csv|json}`
6. Export action is logged in the audit trail (backend audit log)
7. Export button is visible in the page header area next to filters

## Tasks / Subtasks

- [x] Task 1: Create export button component (AC: 1, 7)
  - [x] 1.1 Create `apps/web/components/features/analytics/analytics-export-button.tsx`
  - [x] 1.2 Use shadcn `DropdownMenu` with two options: "Export CSV" and "Export JSON"
  - [x] 1.3 Place in the analytics page header/filters bar

- [x] Task 2: Implement client-side export logic (AC: 2-5)
  - [x] 2.1 Create `apps/web/lib/export-utils.ts` with:
    - `exportToCsv(data, filename)` — converts analytics data to CSV string and triggers download
    - `exportToJson(data, filename)` — stringifies data and triggers download
  - [x] 2.2 CSV format: headers row + data rows for KPIs, then blank row, then agent metrics table
  - [x] 2.3 Generate filename: `analytics-{orgName}-{YYYY-MM-DD}-{YYYY-MM-DD}.csv`
  - [x] 2.4 Trigger browser download via `Blob` + `URL.createObjectURL` + programmatic `<a>` click

- [x] Task 3: Backend audit logging (AC: 6)
  - [x] 3.1 Add `POST /api/analytics/export-log` endpoint to analytics controller
  - [x] 3.2 Logs: userId, exportFormat, dateRange, timestamp to AuditLog table
  - [x] 3.3 Frontend calls this endpoint after successful export

## Dev Notes

### Export Button

```tsx
// apps/web/components/features/analytics/analytics-export-button.tsx
export function AnalyticsExportButton({ summaryData, agentData, dateRange, orgName }: ExportProps) {
  const api = useApiClient();

  const handleExport = async (format: 'csv' | 'json') => {
    const filename = `analytics-${orgName}-${format(dateRange.start, 'yyyy-MM-dd')}-${format(dateRange.end, 'yyyy-MM-dd')}`;

    if (format === 'csv') {
      exportToCsv({ summary: summaryData, agents: agentData }, `${filename}.csv`);
    } else {
      exportToJson({ summary: summaryData, agents: agentData }, `${filename}.json`);
    }

    // Log export to audit trail
    await api.post('/analytics/export-log', {
      format,
      startDate: dateRange.start.toISOString(),
      endDate: dateRange.end.toISOString(),
    }).catch(() => {}); // non-blocking
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleExport('csv')}>Export CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('json')}>Export JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Export Utilities

```typescript
// apps/web/lib/export-utils.ts
export function exportToCsv(data: AnalyticsExportData, filename: string) {
  const lines: string[] = [];

  // KPI Summary section
  lines.push('KPI Summary');
  lines.push('Metric,Value,Trend (%)');
  Object.entries(data.summary.kpis).forEach(([key, { value, trend }]) => {
    lines.push(`${key},${value},${trend ?? ''}`);
  });

  lines.push(''); // blank separator

  // Agent Metrics section
  lines.push('Per-Agent Metrics');
  lines.push('Agent,Conversations,Messages,Avg Response (ms),Queries');
  data.agents.data.forEach(agent => {
    lines.push(`${agent.agentName},${agent.conversations},${agent.messages},${agent.avgResponseTimeMs},${agent.queriesRaised}`);
  });

  downloadFile(lines.join('\n'), filename, 'text/csv');
}

export function exportToJson(data: AnalyticsExportData, filename: string) {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Backend Audit Log Endpoint

```typescript
// In analytics.controller.ts
@Post('export-log')
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
async logExport(
  @Body() body: { format: string; startDate: string; endDate: string },
  @CurrentUser() user: CurrentUserData,
) {
  await this.prisma.auditLog.create({
    data: {
      userId: user.id,
      auth0Id: user.auth0Id,
      event: 'ANALYTICS_EXPORT',
      data: { format: body.format, startDate: body.startDate, endDate: body.endDate },
    },
  });
  return { success: true };
}
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/analytics-export-button.tsx`
- New: `apps/web/lib/export-utils.ts`
- Modify: `apps/web/components/features/analytics/analytics-page-client.tsx` — add export button to filter bar
- Modify: `apps/api/src/controllers/analytics/analytics.controller.ts` — add export-log endpoint
- Uses: `apps/web/components/ui/dropdown-menu.tsx`, `button.tsx`

### References

- [Source: apps/web/components/ui/dropdown-menu.tsx] — DropdownMenu component (already installed)
- [Source: apps/api/prisma/schema.prisma] — AuditLog model
- [Source: 8-1-analytics-api-endpoints.md] — Analytics API response shapes
- [Source: 8-2-analytics-dashboard-page-layout.md] — Filter bar placement

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- Task 1: Created AnalyticsExportButton component using shadcn DropdownMenu with CSV/JSON options. Placed in analytics page filter bar with ml-auto alignment (right side). Button disabled when no data or empty state.
- Task 2: Created export-utils.ts with exportToCsv (KPI summary + per-agent metrics sections), exportToJson (full data), and downloadFile helper using Blob + createObjectURL. CSV fields properly escaped. Filenames sanitized (non-alphanumeric chars replaced).
- Task 3: Added POST /analytics/export-log endpoint to AnalyticsController, delegating to AnalyticsService.logExport which creates an AuditLog entry with ANALYTICS_EXPORT event. Added useAgentAnalytics query to page client to supply agent data for export. 7 new unit tests (4 service + 3 controller) all passing.
- All 798 backend tests passing. Lint, type-check, and build all green.
- Code review fixes applied (6 issues resolved):
  - [HIGH] Added Zod validation (exportLogBodySchema) to POST /analytics/export-log — rejects invalid format, missing fields, strips extra fields
  - [HIGH] Removed polling from exportAgentsQuery — data only used on export click, no need for 60s refetch
  - [MEDIUM] Added date range metadata row to CSV export header
  - [MEDIUM] AnalyticsExportData type import is valid (used as type annotation) — false positive, no change needed
  - [LOW] Added UTF-8 BOM (\uFEFF) to CSV for Excel compatibility
  - Added 7 new validation tests for exportLogBodySchema (805 total tests passing)

### File List
- New: `apps/web/components/features/analytics/analytics-export-button.tsx`
- New: `apps/web/lib/export-utils.ts`
- Modified: `apps/web/components/features/analytics/analytics-page-client.tsx`
- Modified: `apps/api/src/controllers/analytics/analytics.controller.ts`
- Modified: `apps/api/src/services/analytics.service.ts`
- Modified: `apps/api/src/models/analytics.dto.ts`
- Modified: `apps/api/test/controllers/analytics/analytics.controller.spec.ts`
- Modified: `apps/api/test/services/analytics/analytics.service.spec.ts`
- Modified: `packages/validation/src/analytics.ts`
