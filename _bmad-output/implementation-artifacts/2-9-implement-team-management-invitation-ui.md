# Story 2.9: Implement Team Management & Invitation UI

Status: done

## Story

As an **Admin or Super Admin**,
I want a Team page in the dashboard to manage members and send invitations,
So that I can invite new users, view team members, and manage pending invitations.

## Acceptance Criteria

1. **Given** I am logged in as Admin or Super Admin
   **When** I navigate to the Team page (`/dashboard/team`)
   **Then** I see two sections: "Team Members" and "Pending Invitations"

2. **Given** the Team Members section
   **When** I view the table
   **Then** each row shows: name (or email fallback), email, role badge, joined date
   **And** members are sorted by join date (newest first)

3. **Given** the Pending Invitations section
   **When** I view the table
   **Then** each row shows: email, role, status badge, sent date, expiration date
   **And** each row has actions: Resend, Cancel

4. **Given** I click "Invite Member" button
   **When** the invite dialog opens
   **Then** I can enter an email and select a role (CLIENT or ADMIN for Super Admin, CLIENT only for Admin)
   **And** submitting calls POST `/api/codeweaves/v1/invitations`
   **And** success shows a toast and refreshes the invitations list

5. **Given** I click "Resend" on a pending invitation
   **When** I confirm the action
   **Then** it calls PUT `/api/codeweaves/v1/invitations/:id/resend`
   **And** success shows a toast notification

6. **Given** I click "Cancel" on a pending invitation
   **When** I confirm the action
   **Then** it calls DELETE `/api/codeweaves/v1/invitations/:id`
   **And** the invitation is removed from the list

7. **Given** I am logged in as a Client user
   **When** I try to access `/dashboard/team`
   **Then** I am redirected (page not accessible)

8. **Given** no team members or invitations exist
   **When** I view the Team page
   **Then** I see appropriate empty states with CTAs

9. **Given** I submit an invitation for an email that already has an account
   **When** the API returns a 409 conflict
   **Then** I see an error message "This user already has an account"

10. **Given** I submit an invitation for an email with a pending invitation
    **When** the API returns a 409 conflict
    **Then** I see an error message "A pending invitation already exists for this email"

## Tasks / Subtasks

- [x] Task 1: Create Team page (`apps/web/app/dashboard/team/page.tsx`)
  - [x] Role-based access check (redirect if CLIENT)
  - [x] Page layout with "Team Members" and "Pending Invitations" sections
  - [x] "Invite Member" button in header

- [x] Task 2: Create TeamMembersList component
  - [x] Use shadcn Table component
  - [x] Columns: Member (avatar + name/email), Email, Role (badge), Joined
  - [x] Loading skeleton state
  - [x] Empty state

- [x] Task 3: Create PendingInvitationsList component
  - [x] Use shadcn Table component
  - [x] Columns: Email, Role (badge), Status (badge with color), Sent, Expires, Actions
  - [x] Action buttons: Resend (icon), Cancel (icon)
  - [x] Confirmation dialog for Cancel action
  - [x] Loading skeleton state
  - [x] Empty state

- [x] Task 4: Create InviteMemberDialog component
  - [x] Use shadcn Dialog, Input, Select components
  - [x] Email input with validation
  - [x] Role select dropdown
    - [x] Super Admin: CLIENT, ADMIN options
    - [x] Admin: CLIENT only
  - [x] Submit button with loading state
  - [x] Error handling (duplicate email, existing invitation)
  - [x] Success: close dialog, invalidate queries, show toast

- [x] Task 5: Create Team API hooks (`apps/web/hooks/use-team.ts`)
  - [x] `useTeamMembers()` — fetches org members via `GET /organizations/:orgId/members`
  - [x] `usePendingInvitations()` — fetches invitations via `GET /invitations`
  - [x] `useInviteMember()` — mutation for `POST /invitations`
  - [x] `useResendInvitation()` — mutation for `POST /invitations/:id/resend` (actual backend uses POST, not PUT)
  - [x] `useCancelInvitation()` — mutation for `DELETE /invitations/:id`
  - [x] All mutations invalidate relevant queries on success

- [x] Task 6: Add Toast notifications
  - [x] Sonner already installed — used existing `toast` from `sonner`
  - [x] Success toasts: "Invitation sent", "Invitation resent", "Invitation cancelled"
  - [x] Error toasts: API error messages

- [x] Task 7: Update sidebar navigation
  - [x] Verified "Team" nav item exists in sidebar.tsx
  - [x] Updated roles from `'all'` to `['SUPER_ADMIN', 'ADMIN']`

- [x] Task 8: Handle Super Admin invite flow (no org context)
  - [x] Backend requires organizationId (non-nullable in schema) — no org-less invites possible
  - [x] UI shows "No organization selected" empty state when Super Admin has no org context
  - [x] UI adapts based on whether user has org context

## Dev Notes

### Page Structure

```text
/dashboard/team
├── Header: "Team" + "Invite Member" button
├── Section: Team Members
│   └── Table: Avatar | Name | Email | Role | Joined
├── Section: Pending Invitations
│   └── Table: Email | Role | Status | Sent | Expires | Actions
└── InviteMemberDialog (modal)
```

### API Endpoints Used

```text
GET    /api/codeweaves/v1/invitations              — List pending invitations
POST   /api/codeweaves/v1/invitations              — Create invitation
PUT    /api/codeweaves/v1/invitations/:id/resend   — Resend invitation
DELETE /api/codeweaves/v1/invitations/:id           — Cancel invitation
GET    /api/codeweaves/v1/organizations/:id/members — List org members (Story 2.6)
```

### shadcn Components Needed

```bash
bunx shadcn@latest add table
bunx shadcn@latest add dialog
bunx shadcn@latest add select
bunx shadcn@latest add sonner
bunx shadcn@latest add badge
```

### TanStack Query Keys

```typescript
queryKey: ['team-members', organizationId]
queryKey: ['invitations', organizationId]
```

### Role Badge Colors

| Role | Color |
|------|-------|
| SUPER_ADMIN | Red/destructive |
| ADMIN | Blue/primary |
| CLIENT | Gray/secondary |

### Invitation Status Badge Colors

| Status | Color |
|--------|-------|
| PENDING | Yellow/warning |
| ACCEPTED | Green/success |
| EXPIRED | Red/destructive |

### Architecture Compliance

- **FR1:** User registration via invitation only
- **Stories 1.6, 1.7, 1.11:** Backend invitation APIs (already implemented)
- **ADR-010:** TanStack Query for server state, Zustand for client state
- **Performance:** Query caching, optimistic updates where appropriate
- shadcn components only (per CLAUDE.md)

### Dependencies

- Stories 1.6, 1.7, 1.11 (Backend invitation APIs — done)
- Story 2.6 (Organization membership endpoints — member list)
- Story 2.8 (Organization context — role checks, org ID)
- Existing: TanStack Query, shadcn UI components, useApiClient

### References

- Backend invitation controller: `apps/api/src/controllers/invitations/invitations.controller.ts`
- Backend invitation service: `apps/api/src/services/invitations.service.ts`
- Invitation validation schemas: `packages/validation/src/index.ts`

## Dev Agent Record

### Implementation Plan
- Created TanStack Query hooks for team members and invitations (use-team.ts)
- Built Team page with role-based access (CLIENT redirect) and org-context check
- Created TeamMembersList with avatar, role badges, skeleton and empty states
- Created PendingInvitationsList with resend/cancel actions, AlertDialog confirmation, tooltips
- Created InviteMemberDialog with email validation, role-based role selection (Super Admin sees ADMIN+CLIENT, Admin sees CLIENT only)
- Updated sidebar to restrict Team nav to SUPER_ADMIN and ADMIN roles
- All components follow existing codebase patterns (organizations page, create-org dialog)

### Decisions
- Resend endpoint uses POST (actual backend) instead of PUT (story spec) — aligned with real API
- Task 8: Backend schema requires organizationId (non-nullable), so Super Admin without org sees an informative empty state directing them to Organizations page
- Installed `badge`, `select`, `alert-dialog` shadcn components; `sonner` was already present
- Pending invitations list filters to show only PENDING status invitations

### Completion Notes
- All 8 tasks and subtasks implemented and marked complete
- Type check: PASS
- Lint: PASS (0 warnings)
- Build: PASS (all packages)
- Tests: 355 passed, 0 failed (no regressions)
- This is a frontend-only story — no new backend unit tests required

### Code Review Fixes Applied
- **#1 HIGH**: Added resend confirmation AlertDialog (AC-5 compliance)
- **#2 MED**: Added error state UI with AlertCircle for both TeamMembersList and PendingInvitationsList
- **#3+#4 MED**: Updated `usePendingInvitations` to accept organizationId param, added to query key, and uses `select` for client-side org filtering
- **#5 MED**: Extracted duplicate `formatDate` to shared `apps/web/lib/utils.ts`
- **#6+#7 LOW**: Consolidated TooltipProvider to wrap both tooltips per row instead of individual wrapping
- Post-fix validation: type-check PASS, lint PASS, build PASS

## File List

### New Files
- `apps/web/hooks/use-team.ts` — TanStack Query hooks for team members and invitations
- `apps/web/components/features/team/team-members-list.tsx` — Team members table with role badges
- `apps/web/components/features/team/pending-invitations-list.tsx` — Pending invitations table with actions
- `apps/web/components/features/team/invite-member-dialog.tsx` — Invite member dialog with form
- `apps/web/components/ui/badge.tsx` — shadcn Badge component (newly installed)
- `apps/web/components/ui/select.tsx` — shadcn Select component (newly installed)
- `apps/web/components/ui/alert-dialog.tsx` — shadcn AlertDialog component (newly installed)

### Modified Files
- `apps/web/app/(protected)/dashboard/team/page.tsx` — Replaced placeholder with full Team page
- `apps/web/components/layout/sidebar.tsx` — Restricted Team nav to SUPER_ADMIN and ADMIN
- `apps/web/lib/utils.ts` — Added shared formatDate utility

## Change Log

- 2026-02-16: Implemented Story 2-9 — Team Management & Invitation UI. Created team page with members table, invitations table, invite dialog, and role-based access control.
- 2026-02-16: Code review fixes — Added resend confirmation dialog, error states, org-scoped invitation filtering, shared formatDate utility, consolidated TooltipProvider.
