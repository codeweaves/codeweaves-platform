# Story 11.12: GDPR Data Export

Status: ready-for-dev

## Story

As a **user**,
I want to export all my personal data,
So that I can comply with GDPR data portability rights.

## Acceptance Criteria

1. **Given** an authenticated user **When** POST /api/codeweaves/v1/users/me/data-export is called **Then** a JSON file containing all their personal data is generated and returned
2. **Given** data export runs **When** collecting data **Then** it includes: user profile, organization membership, chat sessions (as participant), chat messages sent, audit log entries for the user
3. **Given** the export **When** generated **Then** sensitive fields are included but secrets (passwords, API keys) are excluded
4. **Given** the export **When** returned **Then** Content-Disposition header triggers download with filename user-data-export-{date}.json
5. **Given** the export **When** completed **Then** an audit log entry is created recording the export event
6. **Given** a large dataset **When** exporting **Then** the response streams the JSON to avoid memory issues (for users with thousands of messages)
7. **Given** tests exist **Then** unit tests cover data collection from each model, exclusion of secrets, audit log creation

## Tasks / Subtasks

- [ ] Task 1: Create GdprModule (AC: #1)
  - [ ] Create `apps/api/src/modules/gdpr/gdpr.module.ts`
  - [ ] Import PrismaModule, TracerModule, and any other required modules
  - [ ] Register GdprController and GdprService as providers
- [ ] Task 2: Create GdprService — collectUserData method (AC: #1, #2, #3, #6)
  - [ ] Create `apps/api/src/services/gdpr.service.ts`
  - [ ] Implement `collectUserData(userId: string)` method
  - [ ] Query User profile (exclude internal-only fields)
  - [ ] Query Organization membership via user's organizationId
  - [ ] Query ChatSessions where userId matches or deviceId is linked to user
  - [ ] Query ChatMessages sent by the user (sender matches)
  - [ ] Query AuditLog entries where userId matches
  - [ ] Exclude AgentSecret values, password hashes, internal system fields from all results
  - [ ] Return structured data object with sections: profile, organization, chatSessions, chatMessages, auditLogs
- [ ] Task 3: Create GdprController — POST /users/me/data-export (AC: #1, #4, #5, #6)
  - [ ] Create `apps/api/src/modules/gdpr/gdpr.controller.ts`
  - [ ] Implement POST endpoint at `/users/me/data-export`
  - [ ] Use `@CurrentUser()` decorator to get requesting user's ID
  - [ ] Call GdprService.collectUserData(userId)
  - [ ] Set Content-Type: application/json
  - [ ] Set Content-Disposition: attachment; filename="user-data-export-{YYYY-MM-DD}.json"
  - [ ] For large datasets, use NestJS StreamableFile or Node.js readable stream
  - [ ] Log export event via TracerService with event `GDPR_DATA_EXPORT`
- [ ] Task 4: Register GdprModule in AppModule (AC: #1)
  - [ ] Import GdprModule in `apps/api/src/app.module.ts`
- [ ] Task 5: Create unit tests for GdprService (AC: #7)
  - [ ] Create `apps/api/test/services/gdpr/gdpr.service.spec.ts`
  - [ ] Test data collection from each model (User, Organization, ChatSession, ChatMessage, AuditLog)
  - [ ] Test that AgentSecret values are excluded from export
  - [ ] Test that the export structure matches expected schema
  - [ ] Test audit log creation on export
- [ ] Task 6: Create unit tests for GdprController (AC: #7)
  - [ ] Create `apps/api/test/controllers/gdpr/gdpr.controller.spec.ts`
  - [ ] Test POST /users/me/data-export returns 200 with correct headers
  - [ ] Test Content-Disposition header contains correct filename format
  - [ ] Test unauthenticated request returns 401

## Dev Notes

### Architecture Compliance

- This is a synchronous export (not queued). For our current scale, direct download is simpler and sufficient compared to async/email delivery.
- Uses Prisma queries to collect data from each model.
- For streaming large datasets, use NestJS `StreamableFile` or Node.js readable streams to avoid loading all data into memory at once.
- Controller uses `@CurrentUser()` decorator to get the requesting user's ID from the JWT, consistent with existing patterns.

### Existing Patterns to Follow

- Controller/Service separation as seen in other modules (e.g., `apps/api/src/modules/users/`)
- TracerService usage for audit logging (event name: `GDPR_DATA_EXPORT`)
- Auth guards: `@UseGuards(JwtAuthGuard, UserSyncGuard)` on the controller
- API prefix `/api/codeweaves/v1` is set globally — controller route is just `/users/me/data-export`

### What This Story Does NOT Include

- Async/queued export with email delivery (overkill for current scale)
- PDF or CSV export formats (JSON only for GDPR portability)
- Admin-initiated export on behalf of other users
- Data export scheduling or recurring exports

### Project Structure Notes

- New module: `apps/api/src/modules/gdpr/gdpr.module.ts`
- New controller: `apps/api/src/modules/gdpr/gdpr.controller.ts`
- New service: `apps/api/src/services/gdpr.service.ts`
- Tests: `apps/api/test/services/gdpr/gdpr.service.spec.ts`, `apps/api/test/controllers/gdpr/gdpr.controller.spec.ts`

### Data to Include in Export

```json
{
  "exportDate": "2026-03-10T00:00:00Z",
  "profile": {
    "id": "...",
    "email": "...",
    "name": "...",
    "role": "...",
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "organization": {
    "id": "...",
    "name": "...",
    "slug": "..."
  },
  "chatSessions": [...],
  "chatMessages": [...],
  "auditLogs": [...]
}
```

### Fields to EXCLUDE

- AgentSecret values (API keys, webhook secrets)
- Any password hashes (Auth0 manages these, not in our DB)
- Internal system fields (e.g., internal IDs not relevant to the user)
- auth0Id (internal identity correlation, not user-facing data)

### Testing Approach

- Unit tests with mocked PrismaService for each data collection query
- Mock TracerService to verify audit log creation
- Test controller response headers and status codes
- No frontend tests (per project convention)

### References

- architecture.md — NFR26: GDPR data export, FR related to data portability
- Existing TracerService pattern for audit logging
- NestJS StreamableFile documentation for streaming responses

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
