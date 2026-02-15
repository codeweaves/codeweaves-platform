# Story 2.9: Implement Team Management & Invitation UI

Status: backlog

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

9. **Given** I submit an invite for an email that already has an account
   **When** the API returns a 409 conflict
   **Then** I see an error message "This user already has an account"

10. **Given** I submit an invite for an email with a pending invitation
    **When** the API returns a 409 conflict
    **Then** I see an error message "A pending invitation already exists for this email"

## Tasks / Subtasks

- [ ] Task 1: Create Team page (`apps/web/app/dashboard/team/page.tsx`)
  - [ ] Role-based access check (redirect if CLIENT)
  - [ ] Page layout with "Team Members" and "Pending Invitations" sections
  - [ ] "Invite Member" button in header

- [ ] Task 2: Create TeamMembersList component
  - [ ] Use shadcn Table component
  - [ ] Columns: Member (avatar + name/email), Email, Role (badge), Joined
  - [ ] Loading skeleton state
  - [ ] Empty state

- [ ] Task 3: Create PendingInvitationsList component
  - [ ] Use shadcn Table component
  - [ ] Columns: Email, Role (badge), Status (badge with color), Sent, Expires, Actions
  - [ ] Action buttons: Resend (icon), Cancel (icon)
  - [ ] Confirmation dialog for Cancel action
  - [ ] Loading skeleton state
  - [ ] Empty state

- [ ] Task 4: Create InviteMemberDialog component
  - [ ] Use shadcn Dialog, Input, Select components
  - [ ] Email input with validation
  - [ ] Role select dropdown
    - [ ] Super Admin: CLIENT, ADMIN options
    - [ ] Admin: CLIENT only
  - [ ] Submit button with loading state
  - [ ] Error handling (duplicate email, existing invitation)
  - [ ] Success: close dialog, invalidate queries, show toast

- [ ] Task 5: Create Team API hooks (`apps/web/hooks/use-team.ts`)
  - [ ] `useTeamMembers()` — fetches org members via `GET /organizations/:orgId/members`
  - [ ] `usePendingInvitations()` — fetches invitations via `GET /invitations`
  - [ ] `useInviteMember()` — mutation for `POST /invitations`
  - [ ] `useResendInvitation()` — mutation for `PUT /invitations/:id/resend`
  - [ ] `useCancelInvitation()` — mutation for `DELETE /invitations/:id`
  - [ ] All mutations invalidate relevant queries on success

- [ ] Task 6: Add Toast notifications
  - [ ] Add shadcn Toast/Sonner component (`bunx shadcn@latest add sonner`)
  - [ ] Success toasts: "Invitation sent", "Invitation resent", "Invitation cancelled"
  - [ ] Error toasts: API error messages

- [ ] Task 7: Update sidebar navigation
  - [ ] Verify "Team" nav item exists (already in sidebar.tsx)
  - [ ] Ensure it's visible only for ADMIN and SUPER_ADMIN using RoleGate or role filter

- [ ] Task 8: Handle Super Admin invite flow (no org context)
  - [ ] Super Admin can invite ADMIN-level users without an organizationId
  - [ ] API supports creating invitation without organizationId for admin invites
  - [ ] UI adapts based on whether user has org context

## Dev Notes

### Page Structure

```
/dashboard/team
├── Header: "Team" + "Invite Member" button
├── Section: Team Members
│   └── Table: Avatar | Name | Email | Role | Joined
├── Section: Pending Invitations
│   └── Table: Email | Role | Status | Sent | Expires | Actions
└── InviteMemberDialog (modal)
```

### API Endpoints Used

```
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
