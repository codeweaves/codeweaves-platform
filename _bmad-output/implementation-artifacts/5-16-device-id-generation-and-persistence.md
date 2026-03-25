# Story 5-16: Device ID Generation & Persistence

Status: pending

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

- [ ] Task 1: Create device ID module (AC: 1, 4)
  - [ ] Create `apps/widget/src/utils/device-id.ts`
  - [ ] Implement `generateUUID()` using `crypto.randomUUID()` as primary
  - [ ] Implement fallback UUID generation using `crypto.getRandomValues(new Uint8Array(16))` with manual UUID v4 formatting for browsers that lack `randomUUID()`
  - [ ] No external UUID library — native crypto APIs only

- [ ] Task 2: Implement storage strategy with fallback chain (AC: 1, 2)
  - [ ] Primary storage: `localStorage.getItem('cw_device_id')` / `localStorage.setItem('cw_device_id', id)`
  - [ ] Fallback storage: cookie `cw_device_id={uuid}; max-age=31536000; path=/; SameSite=Lax`
  - [ ] Last resort: in-memory variable only (regenerated each page load)
  - [ ] Wrap ALL storage reads and writes in try/catch — `localStorage` can throw `SecurityError` in some iframe/embed contexts, not just quota errors
  - [ ] On storage write failure, log warning: `[CodeWeaves] localStorage unavailable, using fallback`

- [ ] Task 3: Implement `getDeviceId()` function (AC: 1, 2, 3)
  - [ ] Check module-level cache variable first — return immediately if set
  - [ ] Check localStorage for existing `cw_device_id`
  - [ ] Check cookies for existing `cw_device_id` (parse `document.cookie`)
  - [ ] If not found in any store, generate new UUID and persist
  - [ ] Set module-level cache variable before returning
  - [ ] Return the consistent device ID string

- [ ] Task 4: Handle edge cases (AC: 2, 3)
  - [ ] Private browsing mode: localStorage may throw `QuotaExceededError` on write — catch and fall back to cookie
  - [ ] Third-party cookie restrictions: `document.cookie` writes may silently fail in cross-origin iframes — detect by reading back after write
  - [ ] Storage quota exceeded: log warning, use in-memory fallback
  - [ ] Multiple widget instances on same page: module-level cache ensures consistency

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
