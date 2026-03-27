# Story 5-16: Device ID Generation & Persistence

Status: done

## Story

As a **website visitor**,
I want the widget to identify my device consistently,
So that rate limiting works fairly and my session context is maintained across page reloads.

## Acceptance Criteria

1. **Given** a visitor loads the widget for the first time
   **When** the device ID is generated
   **Then** it is persisted in localStorage under `cw_device_id` and reused on subsequent visits

2. **Given** localStorage is unavailable (e.g., private browsing throws on write)
   **When** the device ID needs to be persisted
   **Then** it falls back to a cookie with 1-year expiry

3. **Given** any API call is made during a page session
   **When** the device ID is read
   **Then** the same ID is returned every time (cached in module-level variable)

4. **Given** the widget runs in a modern browser
   **When** a new device ID is generated
   **Then** it uses native `crypto.randomUUID()` or `crypto.getRandomValues()` — no external UUID library

## Tasks / Subtasks

- [x] Task 1: Create device ID module (AC: 1, 4)
  - [x] Create `apps/widget/src/utils/device-id.ts`
  - [x] Implement `generateUUID()` using `crypto.randomUUID()` as primary
  - [x] Implement fallback UUID generation using `crypto.getRandomValues(new Uint8Array(16))` with manual UUID v4 formatting for browsers that lack `randomUUID()`
  - [x] No external UUID library — native crypto APIs only

- [x] Task 2: Implement storage strategy with fallback chain (AC: 1, 2)
  - [x] Primary storage: `localStorage.getItem('cw_device_id')` / `localStorage.setItem('cw_device_id', id)`
  - [x] Fallback storage: cookie `cw_device_id={uuid}; max-age=31536000; path=/; SameSite=Lax`
  - [x] Last resort: in-memory variable only (regenerated each page load)
  - [x] Wrap ALL storage reads and writes in try/catch — `localStorage` can throw `SecurityError` in some iframe/embed contexts, not just quota errors
  - [x] On storage write failure, log warning: `[CodeWeaves] localStorage unavailable, using fallback`

- [x] Task 3: Implement `getDeviceId()` function (AC: 1, 2, 3)
  - [x] Check module-level cache variable first — return immediately if set
  - [x] Check localStorage for existing `cw_device_id`
  - [x] Check cookies for existing `cw_device_id` (parse `document.cookie`)
  - [x] If not found in any store, generate new UUID and persist
  - [x] Set module-level cache variable before returning
  - [x] Return the consistent device ID string

- [x] Task 4: Handle edge cases (AC: 2, 3)
  - [x] Private browsing mode: localStorage may throw `QuotaExceededError` on write — catch and fall back to cookie
  - [x] Third-party cookie restrictions: `document.cookie` writes may silently fail in cross-origin iframes — detect by reading back after write
  - [x] Storage quota exceeded: log warning, use in-memory fallback
  - [x] Multiple widget instances on same page: module-level cache ensures consistency

## Dev Notes

### Storage Key

```
localStorage key:  cw_device_id
Cookie name:       cw_device_id
```

### UUID Generation

```typescript
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: crypto.getRandomValues() with manual v4 formatting
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  return [...bytes].map((b, i) =>
    [4, 6, 8, 10].includes(i)
      ? '-' + b.toString(16).padStart(2, '0')
      : b.toString(16).padStart(2, '0')
  ).join('');
}
```

### Backend Integration

The `MessageRateLimitService` in `apps/api/src/services/message-rate-limit.service.ts` reads device ID from:
1. `X-Device-Id` request header (preferred — set by widget)
2. `request.ip` fallback
3. `X-Forwarded-For` fallback

The widget's API client (Story 5-15) attaches the device ID as `X-Device-Id` header on every request.

### Cookie Fallback Details

- `SameSite=Lax` for cross-site embed compatibility (not `Strict` which would block in iframes)
- `max-age=31536000` (1 year) for long-term persistence
- No `Secure` flag requirement — widget may be embedded on HTTP sites during development
- Cookie read: parse `document.cookie` string, split on `;`, find `cw_device_id=`

### Project Structure

```
apps/widget/src/
  utils/
    device-id.ts    <- This story
```

### References

- Backend rate limit service: `apps/api/src/services/message-rate-limit.service.ts` — reads `X-Device-Id` header
- API client (consumer): Story 5-15 — attaches device ID header
- Session management: Story 5-17 — uses device ID for session scoping

## Dev Agent Record

### Implementation Plan

Single module `apps/widget/src/utils/device-id.ts` implementing all 4 tasks:
- `generateUUID()`: Primary `crypto.randomUUID()`, fallback `crypto.getRandomValues()` with manual UUID v4 formatting
- Storage helpers: `readLocalStorage`/`writeLocalStorage`, `readCookie`/`writeCookie` — all wrapped in try/catch
- `persist()`: Attempts localStorage first, then cookie, falls back to in-memory only
- `getDeviceId()`: Module-level cache → localStorage → cookie → generate new. Exported as the single public API.

### Debug Log

- TypeScript strict mode flagged `bytes[6]` and `bytes[8]` as possibly undefined — fixed with non-null assertions (array is always 16 elements)

### Completion Notes

All 4 tasks implemented in a single focused module. Zero external dependencies. All acceptance criteria satisfied:
- AC1: Device ID persisted in localStorage under `cw_device_id`, reused on subsequent visits
- AC2: Cookie fallback with 1-year expiry when localStorage unavailable; cookie write verified by read-back
- AC3: Module-level cache ensures same ID returned every time within a page session
- AC4: Native `crypto.randomUUID()` primary, `crypto.getRandomValues()` fallback — no UUID library

Lint, type-check, and build all pass. No unit tests required (frontend widget app per project convention).

## Senior Developer Review (AI)

- **Review Date:** 2026-03-27
- **Outcome:** Changes Requested → Fixed
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 11 (3 patch, 3 defer, 5 rejected)
- **Action Items:**
  - [x] **[Med]** P1: Fix `generateUUID()` crash when `crypto` is undefined — added explicit guard + `Math.random` last-resort fallback
  - [x] **[Med]** P2: Add UUID format validation for values read from localStorage/cookies — added `isValidUUID()` regex check
  - [x] **[Low]** P3: Wire `getDeviceId()` into API client `buildHeaders()` — auto-resolves device ID on every request
  - [x] **[Low]** D1: Add `Secure` flag on cookie when running on HTTPS — conditionally appended based on `location.protocol`
  - [x] **[Low]** D2: Log warning when all persistent storage fails — added `console.warn` in `persist()` fallthrough
  - [x] **[Low]** D3: Export `resetDeviceId()` for logout/GDPR flows — clears cache, localStorage, and cookie

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | Med | `generateUUID()` fallback crashes if `crypto` is entirely undefined | Added explicit `typeof crypto === 'undefined'` guard with `Math.random` last-resort UUID |
| P2 | Med | No validation of stored values — arbitrary strings accepted as device ID | Added `isValidUUID()` regex check in `readLocalStorage()` and `readCookie()` |
| P3 | Low | `getDeviceId()` never called — `X-Device-Id` header never sent | Wired `getDeviceId()` into `buildHeaders()` as auto-default in api-client.ts |
| D1 | Low | Cookie missing `Secure` flag on HTTPS sites | Conditionally append `; Secure` when `location.protocol === 'https:'` |
| D2 | Low | Silent failure when all storage unavailable | Added `console.warn` in `persist()` when both localStorage and cookie fail |
| D3 | Low | No way to clear device ID for logout/GDPR | Exported `resetDeviceId()` that clears cache, localStorage, and cookie |

## File List

- `apps/widget/src/utils/device-id.ts` (new) — Device ID generation and persistence module
- `apps/widget/src/services/api-client.ts` (modified) — Wired `getDeviceId()` auto-default into `buildHeaders()`

## Change Log

- 2026-03-27: Implemented device ID generation and persistence module (Tasks 1-4)
- 2026-03-27: Fixed 6 code review findings (P1-P3, D1-D3) — crypto guard, UUID validation, API wiring, Secure cookie, fallback warning, reset function
