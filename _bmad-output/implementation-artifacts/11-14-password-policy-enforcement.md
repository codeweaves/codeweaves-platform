# Story 11.14: Password Policy Enforcement

Status: ready-for-dev

## Story

As a **system**,
I want strong password requirements enforced,
So that user accounts are protected against weak or compromised passwords.

## Acceptance Criteria

1. **Given** Auth0 manages passwords **When** password policy is configured **Then** it is set in the Auth0 Dashboard (not our backend code)
2. **Given** Auth0 password policy **When** a user sets or changes their password **Then** minimum 12 characters, uppercase, lowercase, number, and special character are required
3. **Given** common password detection **When** a user attempts a weak password **Then** Auth0 rejects it using its built-in breached password detection
4. **Given** password history **When** configured in Auth0 **Then** the last 5 passwords cannot be reused
5. **Given** the frontend invitation acceptance flow **When** users set their initial password **Then** Auth0 enforces the policy and returns clear error messages
6. **Given** tests exist **Then** a documentation file records the Auth0 configuration steps and expected behavior (no backend code to test)

## Tasks / Subtasks

- [ ] Task 1: Configure Auth0 password policy in Auth0 Dashboard (AC: #1, #2, #3, #4)
  - [ ] Navigate to Auth0 Dashboard > Authentication > Database > Username-Password-Authentication
  - [ ] Go to Password Policy section
  - [ ] Set password strength to "Good" or "Excellent"
  - [ ] Set minimum password length to 12
  - [ ] Enable requirement for: lowercase letters, uppercase letters, numbers, special characters
  - [ ] Enable Password History with depth of 5
  - [ ] Enable Breached Password Detection
- [ ] Task 2: Verify frontend error handling (AC: #5)
  - [ ] Test the invitation acceptance flow — set a weak password and verify Auth0 Universal Login displays a clear error
  - [ ] Test the password reset flow — verify policy errors are displayed
  - [ ] Confirm Auth0's Universal Login page shows policy requirements to users
- [ ] Task 3: Document Auth0 password policy configuration (AC: #6)
  - [ ] Create `docs/auth0-password-policy.md`
  - [ ] Document the exact Auth0 Dashboard settings configured
  - [ ] Document expected behavior for each policy rule
  - [ ] Document any limitations based on Auth0 plan tier (e.g., password history may require paid tier)
  - [ ] Include screenshots or step-by-step instructions for reconfiguration

## Dev Notes

### Architecture Compliance

- This is primarily an Auth0 configuration story, not a code story. Our backend never sees or stores passwords — Auth0 handles all password storage and validation.
- The acceptance flow (invitation to set password) goes through Auth0's Universal Login page, which automatically enforces the configured password policy.
- Password policy errors from Auth0 are displayed by the Auth0 login form automatically — no custom frontend error handling is needed.
- ADR-005 (Auth0 for Authentication) mandates that all password management is delegated to Auth0.

### Existing Patterns to Follow

- Auth0 configuration is documented alongside the codebase in `docs/` directory
- No backend code changes needed — Auth0 handles all password validation externally

### What This Story Does NOT Include

- Custom password validation logic in our backend
- Custom password strength meter in our frontend
- Password expiration policies (not a GDPR requirement)
- Multi-factor authentication setup (separate story)
- Backend password storage or hashing (Auth0 manages this entirely)

### Project Structure Notes

- New documentation: `docs/auth0-password-policy.md`
- No code changes to `apps/api/` or `apps/web/`
- Auth0 Dashboard configuration is done manually (not via Infrastructure-as-Code)

### Auth0 Plan Tier Considerations

- **Free tier**: Supports password strength policies, minimum length, character requirements, and breached password detection
- **Password History**: May require Auth0 Essentials or Professional plan. If not available on the current plan, document this as a limitation and note the alternative (upgrade to paid tier or accept the limitation)
- **Breached Password Detection**: Available on all plans but may have different notification options per tier

### Testing Approach

- No automated unit tests — this is a configuration story
- Manual verification of Auth0 policy enforcement during invitation acceptance and password reset flows
- Documentation serves as the "test artifact" recording expected behavior
- Verify by attempting to set passwords that violate each rule and confirming Auth0 rejects them

### References

- architecture.md — ADR-005: Auth0 for Authentication
- architecture.md — FR115-FR116: Password validation requirements
- Auth0 Documentation: [Password Policy](https://auth0.com/docs/manage-users/user-accounts/password-security/password-policy)
- Auth0 Documentation: [Breached Password Detection](https://auth0.com/docs/secure/attack-protection/breached-password-detection)
- Story 1-1 (Configure Auth0 Application and API) — initial Auth0 setup

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
