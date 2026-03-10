# Story 12.12: Uptime Monitoring

Status: ready-for-dev

## Story

As an **operator**,
I want external uptime monitoring configured,
So that I know when the service is down and can respond quickly.

## Acceptance Criteria

1. **Given** the production service is deployed
   **When** external monitoring is configured
   **Then** the `/health` endpoint is checked every 60 seconds

2. **Given** downtime
   **When** detected
   **Then** notification is sent within 2 minutes

3. **Given** uptime data
   **When** tracked
   **Then** uptime percentage is calculated (target: 99.9%)

4. **Given** monitoring is configured
   **When** set up
   **Then** it uses an external service (not self-hosted) for independence from our infrastructure

5. **Given** tests exist
   **Then** documentation describes the monitoring setup

## Tasks / Subtasks

- [ ] Task 1: Evaluate and select uptime monitoring service (AC: 1, 4)
  - [ ] Compare free tiers: UptimeRobot (50 monitors, 5-min intervals), Better Stack (60s intervals), Sentry Crons
  - [ ] Select service based on: check interval (60s preferred), free tier limits, alert channel support
  - [ ] Document the selection rationale

- [ ] Task 2: Document primary health check monitor configuration (AC: 1, 2)
  - [ ] Monitor URL: `https://{production-domain}/health`
  - [ ] Check interval: 60 seconds
  - [ ] Expected response: HTTP 200, body contains `"status":"ok"`
  - [ ] Alert on: 2 consecutive failures (avoid flapping from transient issues)
  - [ ] Alert channels: email (required), Slack (optional if configured)

- [ ] Task 3: Document deep health check monitor configuration (AC: 1)
  - [ ] Monitor URL: `https://{production-domain}/health/ready`
  - [ ] Check interval: 300 seconds (5 minutes, less frequent since it checks dependencies)
  - [ ] Expected response: HTTP 200
  - [ ] Alert on: 2 consecutive failures

- [ ] Task 4: Document uptime tracking and SLA target (AC: 3)
  - [ ] Target uptime: 99.9% (allows ~8.7 hours downtime per year)
  - [ ] Document how to view uptime reports in the selected monitoring service
  - [ ] Document how to create a public status page (optional)

- [ ] Task 5: Create setup documentation (AC: 5)
  - [ ] Create `docs/uptime-monitoring.md` with step-by-step setup instructions
  - [ ] Include screenshots or references to the monitoring service dashboard
  - [ ] Include alert channel configuration steps
  - [ ] Include instructions for adding new monitors as services scale

## Dev Notes

### Architecture Compliance

- This is a configuration/documentation story — no backend code changes required
- The `/health` (liveness, Story 12-3) and `/health/ready` (readiness, Story 12-4) endpoints must already exist
- External uptime monitoring is essential because it operates independently from the application infrastructure — if the server goes down, the monitor still detects it

### Existing Patterns to Follow

- Health endpoints follow standard liveness/readiness probe patterns
- `/health` returns `{ "status": "ok" }` for liveness
- `/health/ready` checks database and dependent service connectivity for readiness

### What This Story Does NOT Include

- Self-hosted monitoring solutions (Prometheus, Grafana)
- Application Performance Monitoring (APM) — covered separately
- Internal metrics collection or dashboards
- Incident management runbooks (future story)

### Project Structure Notes

```
docs/
  uptime-monitoring.md    # Setup instructions and configuration reference
```

### Testing Approach

- No automated tests — this is a documentation and configuration story
- Manual verification: confirm monitoring service pings `/health` and receives HTTP 200
- Manual verification: simulate downtime and confirm alert is received within 2 minutes

### References

- `architecture.md` — NFR: 99.9% uptime target, external monitoring requirement
- Story 12-3: `/health` liveness endpoint
- Story 12-4: `/health/ready` readiness endpoint
- UptimeRobot: https://uptimerobot.com (free tier: 50 monitors, 5-min intervals)
- Better Stack: https://betterstack.com (free tier: 60s intervals)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
