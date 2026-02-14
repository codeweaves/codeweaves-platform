# Story 1.11: Auth0 Management API Integration for Invitation Flow

Status: ready-for-dev

## Story

As a **Super Admin**,
I want invited users to receive a secure "Set Your Password" link instead of being able to sign up publicly,
So that only explicitly invited users can create accounts and access the platform.

## Acceptance Criteria

1. **Given** public signup is disabled in Auth0
   **When** a user tries to sign up directly on the Auth0 login page
   **Then** the signup option is not available

2. **Given** I create an invitation via POST `/api/invitations`
   **When** the invitation is created successfully
   **Then** an Auth0 user account is pre-created via Management API with a random temporary password

3. **And** a password change ticket is generated via Auth0 Management API

4. **And** the invitation email contains the "Set Your Password" link (password change ticket URL)

5. **Given** an invited user clicks the "Set Your Password" link
   **When** they set their password on Auth0's secure page
   **Then** they can log in with their new password and the UserSyncInterceptor matches them to their invitation

6. **Given** the password change ticket link has expired
   **When** the admin resends the invitation
   **Then** a new password change ticket is generated for the existing Auth0 account (no duplicate account created)

7. **Given** the invitation has expired
   **When** the admin reissues the invitation
   **Then** a new password change ticket is generated for the existing Auth0 account

8. **Given** the admin cancels an invitation
   **When** the invitation is deleted
   **Then** the Auth0 user account is also deleted (cleanup)

9. **Given** an Auth0 account already exists for the invited email (e.g., cancelled and re-invited)
   **When** a new invitation is created
   **Then** the existing Auth0 account is reused (no duplicate), and a new password change ticket is generated

10. **Given** an admin invites a user
    **When** the user has already set their password but hasn't logged into the app yet
    **Then** the invitation remains PENDING until they log in and the UserSyncInterceptor creates their user record

## Tasks / Subtasks

- [ ] Task 1: Set up Auth0 Machine-to-Machine (M2M) application
  - [ ] Create M2M application in Auth0 Dashboard
  - [ ] Grant permissions: `create:users`, `read:users`, `update:users`, `delete:users`, `create:user_tickets`
  - [ ] Add `AUTH0_M2M_CLIENT_ID` and `AUTH0_M2M_CLIENT_SECRET` to env config
  - [ ] Add `AUTH0_M2M_DOMAIN` (same as AUTH0_DOMAIN) to env config

- [ ] Task 2: Create Auth0 Management API service (AC: 2, 3, 8, 9)
  - [ ] Create `src/services/auth0-management.service.ts`
  - [ ] Implement M2M token fetching with caching (tokens valid ~24h)
  - [ ] Implement `createUser(email: string)` — creates Auth0 user with random password
  - [ ] Implement `deleteUser(auth0Id: string)` — deletes Auth0 user
  - [ ] Implement `getUserByEmail(email: string)` — checks if Auth0 account exists
  - [ ] Implement `createPasswordChangeTicket(auth0UserId: string)` — generates secure password reset URL
  - [ ] Handle errors: duplicate user (409), user not found (404), rate limiting (429)

- [ ] Task 3: Update InvitationsService.create() (AC: 2, 3, 4, 9)
  - [ ] After creating invitation record, call Auth0 Management API:
    1. Check if Auth0 user exists for email (`getUserByEmail`)
    2. If not exists → create Auth0 user (`createUser`)
    3. Generate password change ticket (`createPasswordChangeTicket`)
  - [ ] Store the Auth0 user ID in the invitation record (new column: `auth0UserId`)
  - [ ] Update invitation email template to use password change ticket URL instead of signup link
  - [ ] Handle failure: if Auth0 call fails, still create invitation but log error

- [ ] Task 4: Update InvitationsService.resend() (AC: 6)
  - [ ] Generate new password change ticket for existing Auth0 user
  - [ ] Send new email with updated ticket URL
  - [ ] If Auth0 user doesn't exist (edge case), create it

- [ ] Task 5: Update InvitationsService.reissue() (AC: 7)
  - [ ] Generate new password change ticket for existing Auth0 user
  - [ ] Send new email with updated ticket URL
  - [ ] If Auth0 user doesn't exist (edge case), create it

- [ ] Task 6: Update InvitationsService.cancel() (AC: 8)
  - [ ] After deleting invitation, delete Auth0 user via Management API
  - [ ] Handle gracefully if Auth0 user doesn't exist (already deleted)
  - [ ] Do NOT delete Auth0 user if invitation status is ACCEPTED (user already active)

- [ ] Task 7: Database migration — add `auth0UserId` column (AC: 3)
  - [ ] Add optional `auth0UserId` field to `UserInvitation` model in Prisma schema
  - [ ] Create and run migration
  - [ ] Field is nullable (existing invitations won't have it)

- [ ] Task 8: Update environment configuration
  - [ ] Add to `apps/api/.env.example`:
    - `AUTH0_M2M_CLIENT_ID`
    - `AUTH0_M2M_CLIENT_SECRET`
  - [ ] Add to `apps/api/.env`:
    - Actual M2M credentials

- [ ] Task 9: Disable public signup in Auth0 Dashboard (AC: 1)
  - [ ] Auth0 Dashboard > Authentication > Database > Username-Password-Authentication
  - [ ] Disable "Sign Ups"
  - [ ] Verify: login page no longer shows signup option

- [ ] Task 10: Remove/update frontend signup route (AC: 1)
  - [ ] Remove or repurpose `/signup` page (no longer needed for public signup)
  - [ ] The invitation email link goes directly to Auth0's password reset page, not our app
  - [ ] Update `/reissue-invitation` page if needed

- [ ] Task 11: Write unit tests for Auth0ManagementService
  - [ ] Test createUser success/failure
  - [ ] Test deleteUser success/failure (including 404 handling)
  - [ ] Test getUserByEmail success/not found
  - [ ] Test createPasswordChangeTicket success/failure
  - [ ] Test M2M token caching
  - [ ] Test edge case: create user when email already exists (409 → reuse)

- [ ] Task 12: Update InvitationsService tests
  - [ ] Test create flow with Auth0 Management API mock
  - [ ] Test resend generates new password ticket
  - [ ] Test reissue generates new password ticket
  - [ ] Test cancel deletes Auth0 user
  - [ ] Test cancel does NOT delete Auth0 user if invitation is ACCEPTED
  - [ ] Test create when Auth0 user already exists (reuse)

## Dev Notes

### Auth0 Management API Endpoints Used

```
POST /api/v2/users                    — Create user
GET  /api/v2/users-by-email?email=... — Find user by email
DELETE /api/v2/users/{id}             — Delete user
POST /api/v2/tickets/password-change  — Create password change ticket
POST /oauth/token                     — Get M2M access token
```

### Auth0ManagementService Structure

```typescript
@Injectable()
export class Auth0ManagementService {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  async getManagementToken(): Promise<string> { /* cached M2M token */ }
  async createUser(email: string): Promise<{ user_id: string }> { /* ... */ }
  async getUserByEmail(email: string): Promise<{ user_id: string } | null> { /* ... */ }
  async deleteUser(auth0UserId: string): Promise<void> { /* ... */ }
  async createPasswordChangeTicket(auth0UserId: string): Promise<string> { /* returns ticket URL */ }
}
```

### Updated Invitation Create Flow

```
1. Validate email (not already registered/invited)
2. Create invitation record in DB
3. Check if Auth0 user exists (getUserByEmail)
   - No  → Create Auth0 user (createUser)
   - Yes → Reuse existing Auth0 user
4. Generate password change ticket (createPasswordChangeTicket)
5. Update invitation with auth0UserId
6. Send email with ticket URL
```

### Edge Case: Auth0 API Failure

If Auth0 Management API is down during invitation creation:
- Invitation is still created in our DB (don't fail the whole operation)
- Log the error
- Admin can resend later (which retries the Auth0 operations)
- Email will contain our fallback signup link (graceful degradation)

### Prisma Schema Change

```prisma
model UserInvitation {
  // ... existing fields
  auth0UserId    String?          // Auth0 user ID (set when Auth0 account is pre-created)
}
```

### Password Change Ticket Configuration

```typescript
{
  user_id: auth0UserId,
  result_url: `${DASHBOARD_URL}/login`,  // Redirect after password set
  ttl_sec: 604800,  // 7 days (match invitation expiry)
  mark_email_as_verified: true,
  includeEmailInRedirect: false,
}
```

### Architecture Compliance

- **FR1:** User registration via invitation only (no public signup)
- **ADR-011:** Email via Resend (invitation emails updated to use ticket URL)
- **Security:** No passwords sent via email, Auth0 handles password securely

### References

- Auth0 Management API: https://auth0.com/docs/api/management/v2
- Password Change Ticket: https://auth0.com/docs/api/management/v2/tickets/post-password-change
- M2M Authentication: https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-credentials-flow

## Dev Agent Record

### Agent Model Used
{{agent_model_name_version}}

### Completion Notes List
(none yet)

### File List

Files to create:
- `apps/api/src/services/auth0-management.service.ts`
- `apps/api/test/services/auth0-management.service.spec.ts`

Files to modify:
- `apps/api/prisma/schema.prisma` — Add `auth0UserId` to UserInvitation
- `apps/api/src/services/invitations.service.ts` — Integrate Auth0 Management API
- `apps/api/src/modules/invitations.module.ts` — Register Auth0ManagementService
- `apps/api/test/services/invitations/invitations.service.spec.ts` — Update tests
- `apps/api/.env.example` — Add M2M credentials
- `apps/api/.env` — Add actual M2M credentials
- `apps/web/app/(auth)/signup/page.tsx` — Remove or repurpose
