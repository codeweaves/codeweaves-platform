# Story 5-12: CORS Domain Validation

Status: done

## Story

As an **agent owner**, I want the widget to only work on my allowed domains, so that others cannot embed my agent without permission.

## Acceptance Criteria

1. Current domain is checked against allowed list
2. Wildcard patterns are supported (e.g., `*.example.com`)
3. Widget renders normally if domain is allowed
4. Widget shows "Unauthorized domain" error if not allowed
5. localhost is always allowed (dev hosts: `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`)

## Tasks / Subtasks

- [x] Create `utils/domain-validator.ts` with domain matching logic (AC: #1, #2, #5)
  - [x] Implement `isDomainAllowed(hostname: string, allowedDomains: string[]): boolean`
  - [x] Implement exact match comparison (e.g., `example.com` matches only `example.com`)
  - [x] Implement wildcard matching (`*.example.com` matches `sub.example.com`, `deep.sub.example.com`)
  - [x] Always allow `localhost`, `127.0.0.1`, `0.0.0.0` for development
  - [x] Return `true` when allowedDomains array is empty (no restrictions configured)
- [x] Integrate domain check into widget initialization flow (AC: #1, #3)
  - [x] After config load (5-4) provides allowedDomains, validate current `window.location.hostname`
  - [x] If domain is allowed, proceed with normal widget rendering
- [x] Implement unauthorized domain error state (AC: #4)
  - [x] Create minimal error UI rendered inside shadow DOM: "This widget is not authorized for this domain"
  - [x] Log domain rejection via debug (not console.warn — proper log service deferred; avoids leaking info to unauthorized domains)
  - [x] Do not render the full chat widget (trigger button, chat window, etc.)
- [x] Write unit tests for domain-validator utility (AC: #1, #2, #5)
  - [x] Skipped — widget app has no test infrastructure (no vitest dep/config). Project convention: no frontend unit tests (manual testing only). Pure utility logic is simple enough to verify by inspection and manual testing.

## Dev Notes

### Two Layers of Domain Validation

1. **Client-side (widget):** Check `window.location.hostname` against `config.allowedDomains` before rendering. This provides fast UX feedback — no API call needed to reject unauthorized domains.
2. **Server-side (backend):** CORS middleware already validates the `Origin` header against the agent's `allowedDomains`. This is the real security boundary; client-side validation is a convenience, not a security measure.

### Domain Validator Utility

Create `apps/widget/src/utils/domain-validator.ts`:

```ts
isDomainAllowed(hostname: string, allowedDomains: string[]): boolean
```

- **Wildcard matching:** `*.example.com` matches `sub.example.com` and `deep.sub.example.com` — convert pattern to regex: `*.example.com` → `/^(.+\.)?example\.com$/i`
- **Exact matching:** `example.com` matches only `example.com`
- **Case-insensitive matching:** Call `.toLowerCase()` on both hostname and allowed domain patterns before comparison
- **Dev hosts always allowed:** `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` (unconditional — client-side check is a convenience, not a security boundary)
- **Empty array = allow all:** For agents without domain restrictions configured

### Error State Behavior

- Render a minimal styled `<div>` inside the shadow DOM with the unauthorized message
- **CSP compliance:** Even the "Unauthorized domain" error message must render using constructable stylesheets (`new CSSStyleSheet()` + `adoptedStyleSheets`), not inline styles — blocked by CSP `style-src` on enterprise sites
- Do not initialize the chat widget, WebSocket connections, or API clients
- Console warning helps developers debug domain configuration issues

### Integration Point

- Config loading (story 5-4) fetches `allowedDomains` as part of the agent config response
- **Initialization flow timing:** Domain validation runs AFTER config fetch but BEFORE full widget UI rendering (theme application, preview mode, chat initialization). The shadow root is lightweight and already created at this point (per story 5-2 architecture).
- Backend CORS headers are set per-agent based on the `allowedDomains` field in the Agent model

### Project Structure Notes

- New file: `apps/widget/src/utils/domain-validator.ts`
- Modify: widget initialization flow to call `isDomainAllowed` after config load
- Agent model: `allowedDomains` is a `string[]` field in the database

### References

- Agent model `allowedDomains` field (string[] in database)
- Story 5-4 (config loading provides allowedDomains)
- Backend CORS middleware validates Origin header per-agent

## File List

- `apps/widget/src/utils/domain-validator.ts` — NEW: domain validation utility
- `apps/widget/src/components/Widget.tsx` — MODIFIED: added domain check after config load, unauthorized domain error state
- `apps/widget/src/styles/components.ts` — MODIFIED: added `.cw-domain-error` CSS class
- `apps/widget/src/services/theme-engine.ts` — MODIFIED: fixed wildcard domain handling in preview mode origin matching

## Dev Agent Record

### Implementation Plan
- Created `isDomainAllowed()` utility with exact match, wildcard (`*.example.com`), case-insensitive matching, and dev host bypass
- Integrated domain check in Widget.tsx after config loads but before theme/preview setup — unauthorized domains never get full widget rendering
- Error state uses constructable stylesheets (CSP-safe) via existing `.cw-domain-error` class in component CSS
- Console warning uses existing `warn()` utility which prefixes `[CodeWeaves]`

### Completion Notes
- All 5 acceptance criteria satisfied:
  1. ✅ Domain checked against `config.allowedDomains` after config load
  2. ✅ Wildcard patterns supported (`*.example.com` matches subdomains)
  3. ✅ Normal rendering proceeds when domain is allowed
  4. ✅ Minimal "not authorized" error shown when domain blocked
  5. ✅ `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` always allowed
- Unit tests skipped per project convention (no frontend test infra in widget app)
- Lint, type-check, build all pass clean

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| #1 | Med | AC #5 wording implied dev-mode gating but dev notes said unconditional | Updated spec wording to clarify dev hosts are always allowed |
| #2 | Med | Spec said validation before shadow root creation, but architecture doesn't support that | Updated spec timing note to match actual architecture |
| #3 | Low | `revealWidget()` called even when domain blocked, exposing error div | Skip reveal when `blocked` flag is set |
| #4 | Low | IPv6 loopback `[::1]` not in DEV_HOSTS | Added `[::1]` to DEV_HOSTS set |
| #5 | Low | Non-string entries in allowedDomains could crash `.toLowerCase()` | Added `typeof pattern !== 'string'` guard |
| #7 | Med | Preview mode origin matching didn't handle wildcard patterns | Refactored to split wildcards into suffix-matching with URL hostname extraction |
| #8 | Low | Console `warn()` leaked agent info to unauthorized domains | Changed to `debug()` — proper log service deferred |

## Senior Developer Review (AI)

- **Review Date:** 2026-03-27
- **Outcome:** Changes Requested
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3-layer parallel review)
- **Total Findings:** 13 raw → 8 actionable after triage (2 bad-spec, 3 patch, 3 defer)
- **Action Items:**
  - [x] (Med) Fix spec wording: AC #5 dev hosts unconditional, not mode-gated
  - [x] (Med) Fix spec wording: timing note re shadow root creation
  - [x] (Low) Skip `revealWidget()` when domain is blocked
  - [x] (Low) Add IPv6 loopback `[::1]` to DEV_HOSTS
  - [x] (Low) Defensive type guard for non-string allowedDomains entries
  - [x] (Med) Fix preview mode wildcard handling in theme-engine.ts
  - [x] (Low) Change domain rejection log from `warn()` to `debug()`

## Change Log

- 2026-03-27: Code review fixes — IPv6 dev host, type guard, silent rejection, preview wildcard handling, spec wording
- 2026-03-26: Implemented CORS domain validation (story 5-12) — domain-validator utility, Widget.tsx integration, error state UI
