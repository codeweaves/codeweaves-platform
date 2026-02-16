# Data Models - API Backend

> Generated: 2026-02-14 | Part: api | ORM: Prisma 7.3.0

## Database

- **Engine:** PostgreSQL 16
- **Provider:** Supabase (Cloud-hosted)
- **ORM:** Prisma 7.3.0 with `@prisma/adapter-pg`
- **Schema:** `apps/api/prisma/schema.prisma`

## Entity Relationship Diagram

```
┌─────────────────────┐     ┌──────────────────────────┐
│    Organization      │     │       UserInvitation      │
├─────────────────────┤     ├──────────────────────────┤
│ id          UUID PK │◄─┐  │ id              UUID PK  │
│ name        String  │  │  │ email           String   │
│ createdAt   DateTime│  │  │ role            Role     │
│ updatedAt   DateTime│  │  │ organizationId  String   │
└─────────────────────┘  │  │ token           UUID UQ  │
                         │  │ reissueToken    UUID UQ  │
┌─────────────────────┐  │  │ reissueCount    Int      │
│        User          │  │  │ status          InvStatus│
├─────────────────────┤  │  │ expiresAt       DateTime │
│ id          UUID PK │  │  │ createdAt       DateTime │
│ email       String UQ│  │  │ invitedBy       String?  │
│ name        String?  │  │  └──────────────────────────┘
│ role        Role     │  │
│ auth0Id     String UQ│  │
│ organizationId FK ───┼──┘
│ createdAt   DateTime │
│ updatedAt   DateTime │
└─────────────────────┘
```

## Models

### Organization

**Table:** `organizations`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | UUID | PK, auto-generated | Organization identifier |
| name | String | required | Organization display name |
| createdAt | DateTime | default: now() | Creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification |

**Relations:**
- `users` → User[] (one-to-many)

---

### User

**Table:** `users`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | UUID | PK, auto-generated | User identifier |
| email | String | unique, required | User email address |
| name | String | optional | Display name |
| role | Role | default: CLIENT | User permission level |
| auth0Id | String | unique, required | Auth0 user subject ID |
| organizationId | String | FK → Organization | Tenant membership |
| createdAt | DateTime | default: now() | Creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification |

**Indexes:**
- `organizationId` - Query users by organization
- `auth0Id` - Lookup by Auth0 identity

**Relations:**
- `organization` → Organization (many-to-one)

---

### UserInvitation

**Table:** `user_invitations`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | UUID | PK, auto-generated | Invitation identifier |
| email | String | required | Invitee email |
| role | Role | default: CLIENT | Assigned role |
| organizationId | String | required | Target organization |
| token | UUID | unique, auto-generated | Accept invitation token |
| reissueToken | UUID | unique, auto-generated | Token for re-invitation |
| reissueCount | Int | default: 0 | Number of re-issues |
| status | InvitationStatus | default: PENDING | Current status |
| expiresAt | DateTime | required | Expiration timestamp |
| createdAt | DateTime | default: now() | Creation timestamp |
| invitedBy | String | optional | Inviter user ID |

**Indexes:**
- `email` - Lookup invitations by email
- `organizationId` - Query invitations per org
- `token` - Fast token validation
- `status` - Filter by status

## Enums

### Role

| Value | Description |
|-------|-------------|
| SUPER_ADMIN | Platform-level administrator |
| ADMIN | Organization administrator |
| CLIENT | Regular organization member |

### InvitationStatus

| Value | Description |
|-------|-------------|
| PENDING | Invitation sent, awaiting acceptance |
| ACCEPTED | Invitation accepted, user created |
| EXPIRED | Invitation past expiry date |

## Migrations

| Migration | Date | Description |
|-----------|------|-------------|
| `20260205181643_init` | 2026-02-05 | Initial schema (all 3 tables + enums) |

## Multi-Tenancy Pattern

The platform uses **organization-based multi-tenancy**:
- Every User belongs to exactly one Organization
- UserInvitations are scoped to an Organization
- Queries should always filter by `organizationId` for data isolation
- The `SUPER_ADMIN` role has cross-organization access
