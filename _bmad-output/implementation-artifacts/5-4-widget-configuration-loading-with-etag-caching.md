# Story 5.4: Widget Configuration Loading with ETag Caching

Status: done

## Story

As a **website visitor**,
I want the widget to load configuration efficiently,
So that repeat visits don't re-download unchanged data.

## Acceptance Criteria

1. **Given** a cached ETag exists for the agent
   **When** the widget fetches configuration
   **Then** it includes the `If-None-Match` header with the cached ETag value

2. **Given** the server responds with 304 Not Modified
   **When** the widget processes the response
   **Then** it uses the cached configuration from localStorage

3. **Given** the server responds with 200 OK
   **When** the widget processes the response
   **Then** it caches the new configuration and ETag in localStorage

4. **Given** configuration needs to be persisted
   **When** the widget stores config in localStorage
   **Then** it includes a TTL timestamp and respects the configured expiry

5. **Given** the API is unreachable (network error)
   **When** the widget attempts to load configuration
   **Then** it falls back to the cached configuration if available

6. **Given** a cache hit occurs (config is less than 5 minutes old)
   **When** the widget loads on a repeat visit
   **Then** total load time is under 200ms (NFR4)

## Tasks / Subtasks

- [x] Task 1: Create config-loader service (AC: 1, 2, 3)
  - [x] Create `src/services/config-loader.ts`
  - [x] Implement `loadConfig(agentId: string): Promise<WidgetConfig>` as the main entry point
  - [x] Define `WidgetConfig` type: `{ theme: ThemeConfig, agent: AgentConfig, allowedDomains: string[] }`
  - [x] Define `AgentConfig` type: `{ name: string, greeting: string, starters: string[], ... }`

- [x] Task 2: Implement localStorage cache layer (AC: 4)
  - [x] Use localStorage key `cw_config_{agentId}` for cached config JSON
  - [x] Use localStorage key `cw_etag_{agentId}` for cached ETag string
  - [x] Use localStorage key `cw_ts_{agentId}` for cache timestamp
  - [x] Set default TTL to 5 minutes (300000ms), make configurable
  - [x] Implement `isCacheValid(agentId)`: check if timestamp is within TTL
  - [x] Implement `getCachedConfig(agentId)`: return parsed config or null
  - [x] Implement `setCachedConfig(agentId, config, etag)`: store config, etag, and timestamp
  - [x] Wrap all `localStorage.setItem` calls in try/catch to handle private browsing mode and quota exceeded errors
  - [x] On localStorage write failure, log warning and continue — gracefully degrade to in-memory cache for the session

- [x] Task 3: Implement cache-first fetch strategy (AC: 1, 2, 3, 6)
  - [x] On load, check if cache is valid (less than 5 minutes old)
  - [x] If cache is valid, return cached config immediately (skip API call)
  - [x] If cache is expired or missing, proceed to API fetch
  - [x] When fetching, include `If-None-Match` header with cached ETag (if one exists)

- [x] Task 4: Handle API response codes (AC: 2, 3)
  - [x] On 200 OK: parse response JSON, extract ETag from response headers, store both in cache, return config
  - [x] On 304 Not Modified: use cached config, update cache TTL timestamp, return cached config
  - [x] On 404 Not Found: agent not found — do NOT use cache, show error state in widget, log `[CodeWeaves] Agent not found (404)`
  - [x] On 5xx Server Error: log warning, attempt cache fallback if available
  - [x] On other 4xx: log warning, fall back to cached config if available

- [x] Task 5: Implement network error fallback (AC: 5)
  - [x] Wrap fetch in try/catch
  - [x] Wrap fetch in `Promise.race()` with a 5000ms timeout — treat timeout as a network error and fall back to cache
  - [x] On network error (fetch throws), attempt to use cached config regardless of TTL
  - [x] If cached config exists, log warning: `[CodeWeaves] API unreachable, using cached config`
  - [x] If no cached config exists, log error: `[CodeWeaves] API unreachable and no cached config available`
  - [x] Return null or throw if no config is available at all

- [x] Task 6: Implement anti-FOUC loading behavior (AC: 6)
  - [x] Set widget host element to `opacity: 0` before config is loaded
  - [x] After config loads successfully, transition to `opacity: 1` with CSS transition
  - [x] Use `transition: opacity 0.2s ease-in` for smooth fade-in
  - [x] Ensure the widget never flashes unstyled content
  - [x] On permanent config failure (no config from API and no cache available), set `opacity: 1` and show a minimal error message — never leave the widget invisible forever

- [x] Task 7: Write unit tests for config-loader (AC: 1, 2, 3, 4, 5)
  - [x] Skipped — project convention: no frontend unit tests (manual testing only)

## Dev Notes

### API Endpoint

The backend endpoint already exists: `GET /api/agents/{publicId}/config`

- Returns agent configuration including theme, agent details, and allowed domains
- Returns `ETag` header derived from `AgentTheme.themeVersion` (Prisma field)
- Supports `If-None-Match` request header, returns 304 when ETag matches

### localStorage Schema

```
cw_config_{agentId}  →  JSON string of WidgetConfig
cw_etag_{agentId}    →  ETag string (e.g., "5" or "W/\"abc123\"")
cw_ts_{agentId}      →  Unix timestamp (ms) of when cache was last validated
```

### Cache Strategy Flow

```
loadConfig(agentId)
  ├── Cache valid (< 5min old)?
  │     └── YES → return cached config (instant, <1ms)
  │     └── NO ↓
  ├── Has cached ETag?
  │     └── YES → fetch with If-None-Match header
  │     └── NO  → fetch without ETag
  ├── Response?
  │     ├── 200 → store config + ETag + timestamp → return new config
  │     ├── 304 → update timestamp → return cached config
  │     └── Error → return cached config (if any) or null
```

### Config Shape

```typescript
interface WidgetConfig {
  theme: Record<string, string>;  // 50+ theme properties from AgentTheme
  agent: {
    name: string;
    greeting: string;
    starters: string[];
    avatarUrl?: string;
  };
  allowedDomains: string[];
}
```

### Anti-FOUC Implementation

The widget host element starts hidden and fades in once config is loaded:

```typescript
hostElement.style.opacity = '0';
hostElement.style.transition = 'opacity 0.2s ease-in';

const config = await loadConfig(agentId);
// Apply theme variables...
hostElement.style.opacity = '1';
```

### Performance Target

- Cache hit (valid TTL): < 1ms (localStorage read only)
- Cache miss with 304: ~50-100ms (network round-trip, no body transfer)
- Cache miss with 200: ~100-200ms (network round-trip + body transfer)
- Total load time on cache hit must be < 200ms including rendering (NFR4)

### Project Structure Notes

```
apps/widget/src/
  services/
    config-loader.ts    ← This story
  types/
    config.ts           ← WidgetConfig, AgentConfig, ThemeConfig types
```

### References

- Backend API: `apps/api/src/modules/agents/agents.controller.ts` — GET /api/agents/:publicId/config
- AgentTheme model: `apps/api/prisma/schema.prisma` — themeVersion field used for ETag
- Story 5-3: Script tag initialization (calls loadConfig during init)
- Story 5-5: Theme CSS variables injection (consumes config.theme)

## Dev Agent Record

### Implementation Plan

- Backend: Created `GET /api/public/agents/:publicId/config` endpoint (didn't exist, contrary to story's claim)
- Widget: Created `config-loader.ts` service with localStorage + in-memory fallback cache
- Widget: Updated types with `LoadedWidgetConfig` and `AgentConfig`
- Widget: Integrated config loading into `Widget.tsx` component with anti-FOUC via `revealWidget()`
- Widget: Added `data-api-url` script tag attribute for configurable API base URL
- Backend tests: 4 new controller tests + 4 new service tests (all passing)

### Completion Notes

- All 6 implementation tasks complete, Task 7 (frontend unit tests) skipped per project convention
- Backend endpoint returns theme config, agent info (name, greeting, starters from theme), allowedDomains
- ETag derived from `AgentTheme.version` field — supports If-None-Match → 304
- Anti-FOUC: host element starts at opacity:0, transitions to 1 after config loads (or on error)
- MutationObserver updated to respect revealed/hidden state when reapplying styles
- Widget bundle: 24.41 KB (9.39 KB gzipped)
- All 1298 backend tests pass, 0 regressions

### Code Review Fixes (2026-03-25)

6 patches from code review (3-layer adversarial):
- P1: Added `.catch()` + `.finally()` on loadConfig promise — widget can no longer stay invisible forever
- P2: In-memory cache now keyed by agentId via `Map<string, MemoryEntry>` — no cross-agent cache pollution
- P3: 404 response now calls `clearConfigCache(agentId)` — stale cache for deleted agents is purged
- P4: Replaced `Promise.race`+`setTimeout` with `AbortController` — no more leaked timers
- P5: `apiBaseUrl` trailing slash stripped before URL construction — no double-slash issues
- P6: `revealWidget()` uses `host.style.setProperty('opacity', '1', 'important')` — properly overrides CRITICAL_STYLES

### Debug Log

- `express` import in controller caused test suite failure — replaced with inline type for `res` param
- Lint warnings: removed unused `HttpCode` import, fixed `any` type in test mock

## File List

- `apps/api/src/controllers/public/public-agents.controller.ts` — added GET :publicId/config with ETag
- `apps/api/src/services/agents.service.ts` — added getWidgetConfig(publicId) method
- `apps/api/test/controllers/public/public-agents.controller.spec.ts` — added config endpoint tests
- `apps/api/test/services/agents/agents.service.spec.ts` — added getWidgetConfig tests
- `apps/widget/src/types/index.ts` — added LoadedWidgetConfig, AgentConfig types
- `apps/widget/src/types/global.d.ts` — updated init() signature with optional apiBaseUrl
- `apps/widget/src/services/config-loader.ts` — NEW: config-loader service (cache + fetch + fallback)
- `apps/widget/src/components/Widget.tsx` — integrated config loading + error state + anti-FOUC
- `apps/widget/src/shadow-dom.ts` — anti-FOUC: opacity:0 default, revealWidget() export, MutationObserver fix
- `apps/widget/src/main.tsx` — reads data-api-url, passes apiBaseUrl to Widget + programmatic init

## Change Log

- 2026-03-25: Implemented widget configuration loading with ETag caching (Story 5-4)
- 2026-03-25: Fixed 6 code review findings (P1-P6): promise error handling, per-agent memory cache, 404 cache purge, AbortController timeout, URL trailing slash, opacity !important
