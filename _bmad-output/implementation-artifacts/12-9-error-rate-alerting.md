# Story 12.9: Error Rate Alerting

Status: ready-for-dev

## Story

As an **operator**,
I want alerts when error rates spike above acceptable thresholds,
So that I can respond to production issues before they escalate.

## Acceptance Criteria

1. **Given** errors are captured (via 12-1, 12-2),
   **When** error rate exceeds 1% of requests in a 10-minute window,
   **Then** a Sentry alert triggers.

2. **Given** an alert triggers,
   **When** notifying,
   **Then** it groups similar errors and shows top error types.

3. **Given** first occurrence vs regression,
   **When** an error appears,
   **Then** Sentry distinguishes new issues from regressions.

4. **Given** the alert,
   **When** triggered,
   **Then** it includes error details, affected endpoint, and stack trace summary.

5. **Given** alert configuration,
   **When** set up,
   **Then** it is done via Sentry Dashboard with documentation.

6. **Given** multiple environments,
   **When** alerts are configured,
   **Then** only production triggers alerts.

7. **Given** tests exist,
   **Then** documentation describes the alert setup.

## Tasks / Subtasks

- [ ] Task 1: Append error rate alerting documentation to `docs/sentry-alerting.md` (AC: 5, 7)
  - [ ] Add an "Error Rate Alerting" section to the existing `docs/sentry-alerting.md` (created in 12-8)
  - [ ] Document the purpose, thresholds, and rationale for error rate alerting
  - [ ] Include step-by-step instructions for configuring error alerts in Sentry Dashboard

- [ ] Task 2: Document error rate alert configuration (AC: 1, 4, 6)
  - [ ] Document navigation: Sentry Dashboard > Alerts > Create Alert > Issue
  - [ ] Document condition: Number of events exceeds threshold in a 10-minute window (targeting 1% error rate)
  - [ ] Document filter: `environment = production`, `level = error`
  - [ ] Document action: Send notification (email, Slack if configured)
  - [ ] Document what alert details include: error message, affected endpoint, stack trace summary

- [ ] Task 3: Document error grouping and regression detection (AC: 2, 3)
  - [ ] Document Sentry's default fingerprinting behavior (auto-groups similar errors by stack trace)
  - [ ] Document how Sentry distinguishes new issues from regressions (previously resolved issues recurring)
  - [ ] Document how to review grouped errors in the Sentry Issues view

- [ ] Task 4: Document escalation rules (AC: 1)
  - [ ] Document escalation rule: if alert not acknowledged within 30 minutes, re-notify
  - [ ] Document how to configure escalation in Sentry Dashboard
  - [ ] Note any limitations of the free tier regarding escalation policies

- [ ] Task 5: Configure error rate alerts in Sentry Dashboard (AC: 1, 2, 4, 6)
  - [ ] Create error rate alert rule in Sentry for production environment
  - [ ] Configure 10-minute window with appropriate event count threshold
  - [ ] Configure notification channels (email at minimum)
  - [ ] Enable regression detection (Sentry default behavior)
  - [ ] Add escalation rule for unacknowledged alerts (if supported by tier)

## Dev Notes

### Architecture Compliance

- Implements the NFR requirement for error rate monitoring and incident detection from `architecture.md`.
- The 1% threshold means: if 1000 requests are processed and 10+ result in errors, the alert triggers.
- Sentry's automatic error grouping via stack trace fingerprinting reduces alert noise.

### Existing Patterns to Follow

- Stories 12-1 and 12-2 must be completed first to ensure errors are captured with full context (user, request, correlationId).
- Documentation appends to `docs/sentry-alerting.md` created in story 12-8, keeping all alerting docs in one place.

### What This Story Does NOT Include

- Application code changes — this is purely Sentry Dashboard configuration and documentation.
- Response time alerting (covered in story 12-8).
- Custom error fingerprinting rules (rely on Sentry defaults; customize later if grouping is insufficient).
- PagerDuty, OpsGenie, or other incident management integrations.

### Project Structure Notes

- `docs/sentry-alerting.md` — append to existing file (created in story 12-8).
- No changes to `apps/api` source code.

### Testing Approach

- No unit tests — this story produces documentation, not code.
- Verification is done by confirming alerts are configured in the Sentry Dashboard.
- Document how to test error alerts by temporarily triggering errors in a staging environment or using Sentry's test notification feature.
- Document limitations of the Sentry free tier regarding alerting features (escalation, advanced grouping).

### References

- `docs/architecture.md` — NFR: Error rate monitoring, incident detection.
- Story 12-1 — SentryModule + SentryService for error capture.
- Story 12-2 — Error context enrichment (user, request, correlationId).
- Story 12-8 — Response Time Alerting (shares `docs/sentry-alerting.md`).
- Sentry Alerts documentation: https://docs.sentry.io/product/alerts/

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
