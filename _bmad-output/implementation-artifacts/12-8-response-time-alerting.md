# Story 12.8: Response Time Alerting

Status: ready-for-dev

## Story

As an **operator**,
I want alerts when response times degrade beyond acceptable thresholds,
So that I can respond to performance issues before they impact users.

## Acceptance Criteria

1. **Given** performance data is collected (via 12-7),
   **When** P95 response time exceeds 1.5s for 5 minutes,
   **Then** an alert is configured in Sentry.

2. **Given** an alert triggers,
   **When** the condition is met,
   **Then** it includes affected endpoints and current latency values.

3. **Given** the alert condition resolves,
   **When** P95 drops below threshold,
   **Then** the alert auto-resolves in Sentry.

4. **Given** alert configuration,
   **When** set up,
   **Then** it is done via Sentry Dashboard (not code) with documentation.

5. **Given** multiple environments,
   **When** alerts are configured,
   **Then** only the production environment triggers alerts.

6. **Given** tests exist,
   **Then** a documentation file describes the alert setup (no backend code to test — Sentry-side config).

## Tasks / Subtasks

- [ ] Task 1: Create Sentry alerting documentation file (AC: 4, 6)
  - [ ] Create `docs/sentry-alerting.md`
  - [ ] Document the purpose, thresholds, and rationale for response time alerting
  - [ ] Include step-by-step instructions for configuring alerts in Sentry Dashboard

- [ ] Task 2: Document P95 response time alert configuration (AC: 1, 2, 3, 5)
  - [ ] Document navigation: Sentry Dashboard > Alerts > Create Alert > Performance
  - [ ] Document condition: P95 transaction duration > 1500ms over a 5-minute window
  - [ ] Document environment filter: `environment = production`
  - [ ] Document action: Send notification (email, Slack if configured)
  - [ ] Document auto-resolve behavior: alert resolves when condition is no longer met

- [ ] Task 3: Document endpoint-specific alert configuration (AC: 1, 2)
  - [ ] Document alert for `/api/codeweaves/v1/chat/*` endpoints
  - [ ] Document alert for `/api/codeweaves/v1/analytics/*` endpoints
  - [ ] Include guidance on adding alerts for additional critical endpoints

- [ ] Task 4: Configure alerts in Sentry Dashboard (AC: 1, 2, 3, 5)
  - [ ] Create P95 > 1.5s alert rule in Sentry for production environment
  - [ ] Configure notification channels (email at minimum)
  - [ ] Verify auto-resolve is enabled
  - [ ] Add endpoint-specific alert rules for chat and analytics endpoints

## Dev Notes

### Architecture Compliance

- Implements the NFR requirement for P95 > 1.5s alerting threshold from `architecture.md`.
- Alerting is a Sentry Dashboard configuration, not application code — this keeps alerting decoupled from the application.

### Existing Patterns to Follow

- Story 12-7 must be completed first to ensure performance data is flowing to Sentry.
- Documentation follows the existing `docs/` directory pattern for operational guides.

### What This Story Does NOT Include

- Application code changes — this is purely Sentry Dashboard configuration and documentation.
- Error rate alerting (covered in story 12-9).
- Custom alerting infrastructure or third-party alerting tools.
- Alert configuration via Sentry Terraform provider or API (manual Dashboard setup only).

### Project Structure Notes

- `docs/sentry-alerting.md` — new documentation file (shared with story 12-9).
- No changes to `apps/api` source code.

### Testing Approach

- No unit tests — this story produces documentation, not code.
- Verification is done by confirming alerts are configured in the Sentry Dashboard.
- Document how to test alerts by temporarily lowering thresholds or using Sentry's test notification feature.

### References

- `docs/architecture.md` — NFR: P95 > 1.5s alerting threshold.
- Story 12-7 — Performance Monitoring (APM), provides the transaction data that alerts are based on.
- Sentry Alerts documentation: https://docs.sentry.io/product/alerts/

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
