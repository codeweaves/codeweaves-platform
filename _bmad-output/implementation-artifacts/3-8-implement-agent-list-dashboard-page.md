# Story 3.8: Implement Agent List Dashboard Page

Status: ready-for-dev

> **Prerequisites:** Story 3-1 (Agent backend CRUD) must be complete. Stories 3-4, 3-5, 3-6, 3-7 are NOT required — this page only needs the basic agent list API.

## Story

As a **dashboard user**,
I want to see all my agents in a paginated list,
so that I can manage them from one place, create new ones, and navigate to edit them.

## Acceptance Criteria

1. **AC1:** `/dashboard/agents` page displays a DataTable of agents using the existing DataTable component
2. **AC2:** Table columns: Agent Name, Organization (ADMIN/SUPER_ADMIN only), Status (badge), Created Date
3. **AC3:** Search by agent name (debounced)
4. **AC4:** Filter by status (ACTIVE/INACTIVE)
5. **AC5:** Filter by organization (ADMIN/SUPER_ADMIN only) — dropdown of organizations
6. **AC6:** Sorting by name, createdAt, updatedAt
7. **AC7:** Pagination with page sizes [5, 10, 50, 100]
8. **AC8:** "Create Agent" button visible only to ADMIN/SUPER_ADMIN — opens create dialog
9. **AC9:** Create Agent dialog: name input + organization dropdown → calls `POST /agents`
10. **AC10:** Clicking a row navigates to `/dashboard/agents/[id]` (detail/edit page — story 3-9)
11. **AC11:** CLIENT users only see their own org's agents (backend handles scoping)
12. **AC12:** CLIENT users do NOT see the "Create Agent" button
13. **AC13:** Empty state shows "No agents found" with a create button (admin only)
14. **AC14:** Status column shows colored badge: green for ACTIVE, gray for INACTIVE
15. **AC15:** Loading state shows spinner in the table body

## Tasks / Subtasks

- [ ] **Task 1: Agents Page** (AC: 1, 11, 12)
  - [ ] 1.1 Create `apps/web/app/(protected)/dashboard/agents/page.tsx`
  - [ ] 1.2 Use `useProfile()` hook to get current user role
  - [ ] 1.3 Page header: "Agents" title + description + Create button (admin only)
  - [ ] 1.4 Render `AgentsDataTable` component

- [ ] **Task 2: Agents DataTable Component** (AC: 1, 2, 3, 4, 5, 6, 7, 10, 14, 15)
  - [ ] 2.1 Create `apps/web/components/features/agents/agents-data-table.tsx`
  - [ ] 2.2 Define columns: name, organization (conditional), status (badge), createdAt
  - [ ] 2.3 Use `DataTable` with `onFetch` callback pattern (simplified mode)
  - [ ] 2.4 Build API query string from DataTable params: page, limit, search, status, organizationId, sortBy, sortOrder
  - [ ] 2.5 Call `GET /agents` via `useApiClient().get()`
  - [ ] 2.6 Status badge: `<Badge variant="default">Active</Badge>` (green) / `<Badge variant="secondary">Inactive</Badge>` (gray)
  - [ ] 2.7 Row click → `router.push('/dashboard/agents/${row.id}')`
  - [ ] 2.8 Organization column only shown for ADMIN/SUPER_ADMIN
  - [ ] 2.9 Org filter dropdown only shown for ADMIN/SUPER_ADMIN (fetch orgs list)

- [ ] **Task 3: Create Agent Dialog** (AC: 8, 9, 12)
  - [ ] 3.1 Create `apps/web/components/features/agents/create-agent-dialog.tsx`
  - [ ] 3.2 Dialog form: agent name input + organization select dropdown
  - [ ] 3.3 Organization dropdown fetches from `GET /organizations` (all orgs for admin)
  - [ ] 3.4 Submit calls `POST /agents` with `{ name, organizationId }`
  - [ ] 3.5 On success: toast notification + refresh DataTable (trigger re-fetch)
  - [ ] 3.6 On error: show error toast
  - [ ] 3.7 Only render dialog trigger for ADMIN/SUPER_ADMIN

- [ ] **Task 4: Empty State** (AC: 13)
  - [ ] 4.1 Pass `renderEmpty` prop to DataTable
  - [ ] 4.2 Empty state: illustration/icon + "No agents found" text
  - [ ] 4.3 Show "Create Agent" button in empty state for ADMIN/SUPER_ADMIN

- [ ] **Task 5: Navigation** (AC: 10)
  - [ ] 5.1 Verify `/dashboard/agents` is in the sidebar navigation
  - [ ] 5.2 If not present, add it to the sidebar nav config

## Dev Notes

### Follow the Organizations Page Pattern

The agents page follows the exact same pattern as the organizations page at `apps/web/app/(protected)/dashboard/organizations/page.tsx`. Key similarities:

- Page component with role check
- DataTable component in `components/features/agents/`
- Create dialog component
- `useApiClient()` hook for API calls
- `useProfile()` for role-based rendering

### DataTable Integration — onFetch Pattern

Use the **simplified mode** with `onFetch` callback:

```typescript
'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApiClient } from '@/lib/api-client';
import { useProfile } from '@/hooks/use-profile';
import { DataTable } from '@/components/ui/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { ColumnDef } from '@tanstack/react-table';

interface Agent {
  id: string;
  publicId: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  organizationId: string;
  organization?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export function AgentsDataTable({ emptyAction }: { emptyAction?: React.ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [data, setData] = useState<Agent[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const columns: ColumnDef<Agent>[] = [
    { accessorKey: 'name', header: 'Name' },
    // Conditionally include org column for admins
    ...(isAdmin ? [{
      accessorKey: 'organization.name',
      header: 'Organization',
    }] : []),
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'ACTIVE' ? 'default' : 'secondary'}>
          {row.original.status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
    },
  ];

  const onFetch = useCallback(async ({ page, pageSize, sorting, search, filters }) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (search) params.set('search', search);
      // Extract filters
      const statusFilter = filters?.find(f => f.id === 'status')?.value;
      if (statusFilter) params.set('status', statusFilter);
      const orgFilter = filters?.find(f => f.id === 'organizationId')?.value;
      if (orgFilter) params.set('organizationId', orgFilter);
      // Sorting
      if (sorting?.[0]) {
        params.set('sortBy', sorting[0].id);
        params.set('sortOrder', sorting[0].desc ? 'desc' : 'asc');
      }

      const result = await api.get(`/agents?${params.toString()}`);
      setData(result.data);
      setPageCount(result.meta.totalPages);
      setTotalItems(result.meta.total);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  return (
    <DataTable
      columns={columns}
      data={data}
      pageCount={pageCount}
      totalItems={totalItems}
      onFetch={onFetch}
      searchConfig={{ placeholder: 'Search agents...', searchKey: 'search' }}
      filters={[
        {
          id: 'status',
          label: 'Status',
          options: [
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
          ],
        },
        // Org filter only for admins — populated dynamically
      ]}
      isLoading={isLoading}
      initialPageSize={10}
      onRowClick={(row) => router.push(`/dashboard/agents/${row.id}`)}
    />
  );
}
```

> **Important:** Check the exact DataTable API props before implementing — read the DataTable component source to confirm prop names and filter format.

### Create Agent Dialog Pattern

Follow the organization create dialog pattern:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiClient } from '@/lib/api-client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

// Fetch orgs, show name + org select, submit POST /agents
```

### Status Badge Colors

Use existing Shadcn Badge variants:
- `ACTIVE` → `variant="default"` (green/primary)
- `INACTIVE` → `variant="secondary"` (gray)

If custom colors needed, use `className` override.

### Sidebar Navigation

Check `apps/web/components/` for the sidebar/nav config. Ensure "Agents" is listed with a bot/message icon. The route is `/dashboard/agents`.

### API Response Shape

The `GET /agents` endpoint from story 3-1 returns:
```json
{
  "data": [
    {
      "id": "uuid",
      "publicId": "abc12345",
      "name": "Customer Support Bot",
      "status": "ACTIVE",
      "organizationId": "uuid",
      "organization": { "id": "uuid", "name": "Acme Corp" },
      "createdAt": "2026-02-18T...",
      "updatedAt": "2026-02-18T..."
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 25, "totalPages": 3 }
}
```

### File Structure

```
apps/web/
├── app/(protected)/dashboard/agents/
│   └── page.tsx                                       # NEW — agents list page
├── components/features/agents/
│   ├── agents-data-table.tsx                          # NEW — DataTable wrapper
│   └── create-agent-dialog.tsx                        # NEW — create dialog
```

### References

- [Source: `apps/web/app/(protected)/dashboard/organizations/page.tsx`] — page pattern reference
- [Source: `apps/web/components/ui/data-table/data-table.tsx`] — DataTable component API
- [Source: `apps/web/lib/api-client.ts`] — API client hook
- [Source: `apps/web/hooks/use-profile.ts`] — profile/role hook
- [Source: `AgentEditor/sections/GeneralSettings.tsx`] — org dropdown reference
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1405-1423] — Story 3.8 AC

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
