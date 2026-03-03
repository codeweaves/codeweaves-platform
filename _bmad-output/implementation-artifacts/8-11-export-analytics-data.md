# Story 8.11: Export Analytics Data

Status: ready-for-dev

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

- [ ] Task 1: Create export button component (AC: 1, 7)
  - [ ] 1.1 Create `apps/web/components/features/analytics/analytics-export-button.tsx`
  - [ ] 1.2 Use shadcn `DropdownMenu` with two options: "Export CSV" and "Export JSON"
  - [ ] 1.3 Place in the analytics page header/filters bar

- [ ] Task 2: Implement client-side export logic (AC: 2-5)
  - [ ] 2.1 Create `apps/web/lib/export-utils.ts` with:
    - `exportToCsv(data, filename)` — converts analytics data to CSV string and triggers download
    - `exportToJson(data, filename)` — stringifies data and triggers download
  - [ ] 2.2 CSV format: headers row + data rows for KPIs, then blank row, then agent metrics table
  - [ ] 2.3 Generate filename: `analytics-{orgName}-{YYYY-MM-DD}-{YYYY-MM-DD}.csv`
  - [ ] 2.4 Trigger browser download via `Blob` + `URL.createObjectURL` + programmatic `<a>` click

- [ ] Task 3: Backend audit logging (AC: 6)
  - [ ] 3.1 Add `POST /api/analytics/export-log` endpoint to analytics controller
  - [ ] 3.2 Logs: userId, exportFormat, dateRange, timestamp to AuditLog table
  - [ ] 3.3 Frontend calls this endpoint after successful export

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

### Debug Log References

### Completion Notes List

### File List
