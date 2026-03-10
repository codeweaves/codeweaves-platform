# Story 12.10: Graceful Degradation - AI Service

Status: ready-for-dev

## Story

As a **system**,
I want graceful degradation when the AI service is unavailable,
So that users get helpful fallback messages instead of raw errors.

## Acceptance Criteria

1. **Given** the AI service (n8n webhook) is unreachable
   **When** a chat message is sent
   **Then** the user receives a configurable fallback message via SSE

2. **Given** the fallback message
   **When** sent
   **Then** it says something like "I'm temporarily unavailable. Please try again in a moment." (configurable per agent via theme/config)

3. **Given** the webhook times out (>10s default)
   **When** the timeout occurs
   **Then** the same fallback message is sent (not a raw error)

4. **Given** consecutive failures
   **When** tracked
   **Then** a circuit breaker pattern prevents hammering a down service (open after 5 failures in 60s, half-open after 30s)

5. **Given** the circuit is open
   **When** a message is sent
   **Then** the fallback is returned immediately without attempting the webhook call

6. **Given** the circuit is half-open
   **When** a test request succeeds
   **Then** the circuit closes and normal operation resumes

7. **Given** any AI service error
   **When** it occurs
   **Then** the error is logged with full context but NOT exposed to the user

8. **Given** tests exist
   **Then** unit tests cover timeout handling, fallback messages, circuit breaker state transitions

## Tasks / Subtasks

- [ ] Task 1: Create generic circuit breaker service (AC: 4, 5, 6)
  - [ ] Create `apps/api/src/common/circuit-breaker/circuit-breaker.service.ts`
  - [ ] Implement three states: CLOSED (normal), OPEN (failing, return fallback immediately), HALF_OPEN (test one request)
  - [ ] Configure: `failureThreshold` (5), `resetTimeoutMs` (30000), `monitorWindowMs` (60000)
  - [ ] Track failures in a sliding window within `monitorWindowMs`
  - [ ] Transition CLOSED -> OPEN when failures >= `failureThreshold` within window
  - [ ] Transition OPEN -> HALF_OPEN after `resetTimeoutMs` elapses
  - [ ] Transition HALF_OPEN -> CLOSED on success, HALF_OPEN -> OPEN on failure
  - [ ] Use in-memory Map for single-instance deployment (document Redis migration path)

- [ ] Task 2: Add fallback message configuration to Agent (AC: 2)
  - [ ] Add fallback message field to Agent config or AgentTheme (default: "I'm temporarily unavailable. Please try again in a moment.")
  - [ ] Ensure the fallback message is retrievable when the agent is loaded in ChatService

- [ ] Task 3: Update ChatService to use circuit breaker (AC: 1, 3, 5, 7)
  - [ ] Wrap n8n webhook call in ChatService with circuit breaker
  - [ ] On timeout, error, or circuit-open: send fallback SSE event as a normal `message` event
  - [ ] Log full error context (webhook URL, agent ID, error type, circuit state) via structured Logger
  - [ ] Never expose raw error details to the user

- [ ] Task 4: Write unit tests for circuit breaker (AC: 8)
  - [ ] Create `apps/api/test/common/circuit-breaker/circuit-breaker.service.spec.ts`
  - [ ] Test CLOSED state allows requests through
  - [ ] Test transition CLOSED -> OPEN after threshold failures
  - [ ] Test OPEN state returns fallback immediately (no webhook call)
  - [ ] Test transition OPEN -> HALF_OPEN after reset timeout
  - [ ] Test HALF_OPEN -> CLOSED on success
  - [ ] Test HALF_OPEN -> OPEN on failure
  - [ ] Test sliding window expiry (old failures drop off)

- [ ] Task 5: Update ChatService tests with fallback scenarios (AC: 8)
  - [ ] Update `apps/api/test/services/chat/chat.service.spec.ts`
  - [ ] Test fallback message sent on webhook timeout
  - [ ] Test fallback message sent on webhook unreachable
  - [ ] Test fallback message sent when circuit is open
  - [ ] Test custom fallback message from agent config

## Dev Notes

### Architecture Compliance

- Circuit breaker is a well-known reliability pattern aligned with Epic 12 graceful degradation scope
- The fallback message streams as a normal SSE `message` event so the widget displays it like a regular AI response
- Error details are logged server-side only; the user never sees raw errors or stack traces

### Existing Patterns to Follow

- The existing ChatService already has try/catch around the webhook call — enhance it with circuit breaker logic
- Use NestJS `Logger` for structured error logging (consistent with existing codebase)
- Use `ConfigService` for default circuit breaker config values (env-configurable)
- Injectable NestJS service pattern for CircuitBreakerService

### What This Story Does NOT Include

- Redis-based circuit breaker state (future: needed for multi-instance deployments)
- Admin UI to view or reset circuit breaker state
- Per-agent circuit breaker tuning via dashboard
- Retry logic with exponential backoff (circuit breaker is the pattern here, not retries)

### Project Structure Notes

```
apps/api/src/common/circuit-breaker/
  circuit-breaker.service.ts    # Generic circuit breaker implementation
  circuit-breaker.module.ts     # NestJS module exporting the service

apps/api/test/common/circuit-breaker/
  circuit-breaker.service.spec.ts
```

### Testing Approach

- Unit tests for CircuitBreakerService: test all state transitions, sliding window, and edge cases
- Unit tests for ChatService: mock CircuitBreakerService, test fallback message delivery via SSE
- Use `jest.useFakeTimers()` to test time-based transitions (reset timeout, sliding window expiry)

### References

- `architecture.md` — Epic 12 scope: Graceful degradation patterns, circuit breakers (moved from Epic 7)
- `apps/api/src/services/chat/chat.service.ts` — existing webhook call and error handling
- Circuit breaker pattern: track failures in sliding window, open circuit when threshold exceeded, try again after cooldown

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
