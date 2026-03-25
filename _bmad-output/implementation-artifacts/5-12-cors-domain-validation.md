# Story 5-12: CORS Domain Validation

Status: ready-for-dev

## Story

As an **agent owner**, I want the widget to only work on my allowed domains, so that others cannot embed my agent without permission.

## Acceptance Criteria

1. Current domain is checked against allowed list
2. Wildcard patterns are supported (e.g., `*.example.com`)
3. Widget renders normally if domain is allowed
4. Widget shows "Unauthorized domain" error if not allowed
5. localhost is always allowed in development mode

## Tasks / Subtasks

- [ ] Create `utils/domain-validator.ts` with domain matching logic (AC: #1, #2, #5)
  - [ ] Implement `isDomainAllowed(hostname: string, allowedDomains: string[]): boolean`
  - [ ] Implement exact match comparison (e.g., `example.com` matches only `example.com`)
  - [ ] Implement wildcard matching (`*.example.com` matches `sub.example.com`, `deep.sub.example.com`)
  - [ ] Always allow `localhost`, `127.0.0.1`, `0.0.0.0` for development
  - [ ] Return `true` when allowedDomains array is empty (no restrictions configured)
- [ ] Integrate domain check into widget initialization flow (AC: #1, #3)
  - [ ] After config load (5-4) provides allowedDomains, validate current `window.location.hostname`
  - [ ] If domain is allowed, proceed with normal widget rendering
- [ ] Implement unauthorized domain error state (AC: #4)
  - [ ] Create minimal error UI rendered inside shadow DOM: "This widget is not authorized for this domain"
  - [ ] Log warning to console: `[CodeWeaves] Domain "${hostname}" is not in the allowed domains list for agent "${agentId}"`
  - [ ] Do not render the full chat widget (trigger button, chat window, etc.)
- [ ] Write unit tests for domain-validator utility (AC: #1, #2, #5)
  - [ ] Test exact domain matching
  - [ ] Test wildcard pattern matching (single-level and multi-level subdomains)
  - [ ] Test localhost/127.0.0.1/0.0.0.0 always allowed
  - [ ] Test empty allowedDomains array allows all
  - [ ] Test case-insensitive matching

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
- **Dev hosts always allowed:** `localhost`, `127.0.0.1`, `0.0.0.0`
- **Empty array = allow all:** For agents without domain restrictions configured

### Error State Behavior

- Render a minimal styled `<div>` inside the shadow DOM with the unauthorized message
- **CSP compliance:** Even the "Unauthorized domain" error message must render using constructable stylesheets (`new CSSStyleSheet()` + `adoptedStyleSheets`), not inline styles — blocked by CSP `style-src` on enterprise sites
- Do not initialize the chat widget, WebSocket connections, or API clients
- Console warning helps developers debug domain configuration issues

### Integration Point

- Config loading (story 5-4) fetches `allowedDomains` as part of the agent config response
- **Initialization flow timing:** Domain validation runs AFTER config fetch but BEFORE shadow root creation and widget rendering — this prevents unnecessary DOM creation for unauthorized domains
- Backend CORS headers are set per-agent based on the `allowedDomains` field in the Agent model

### Project Structure Notes

- New file: `apps/widget/src/utils/domain-validator.ts`
- Modify: widget initialization flow to call `isDomainAllowed` after config load
- Agent model: `allowedDomains` is a `string[]` field in the database

### References

- Agent model `allowedDomains` field (string[] in database)
- Story 5-4 (config loading provides allowedDomains)
- Backend CORS middleware validates Origin header per-agent
