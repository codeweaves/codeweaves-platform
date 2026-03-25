# Story 5.4: Widget Configuration Loading with ETag Caching

Status: ready-for-dev

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

- [ ] Task 1: Create config-loader service (AC: 1, 2, 3)
  - [ ] Create `src/services/config-loader.ts`
  - [ ] Implement `loadConfig(agentId: string): Promise<WidgetConfig>` as the main entry point
  - [ ] Define `WidgetConfig` type: `{ theme: ThemeConfig, agent: AgentConfig, allowedDomains: string[] }`
  - [ ] Define `AgentConfig` type: `{ name: string, greeting: string, starters: string[], ... }`

- [ ] Task 2: Implement localStorage cache layer (AC: 4)
  - [ ] Use localStorage key `cw_config_{agentId}` for cached config JSON
  - [ ] Use localStorage key `cw_etag_{agentId}` for cached ETag string
  - [ ] Use localStorage key `cw_ts_{agentId}` for cache timestamp
  - [ ] Set default TTL to 5 minutes (300000ms), make configurable
  - [ ] Implement `isCacheValid(agentId)`: check if timestamp is within TTL
  - [ ] Implement `getCachedConfig(agentId)`: return parsed config or null
  - [ ] Implement `setCachedConfig(agentId, config, etag)`: store config, etag, and timestamp
  - [ ] Wrap all `localStorage.setItem` calls in try/catch to handle private browsing mode and quota exceeded errors
  - [ ] On localStorage write failure, log warning and continue — gracefully degrade to in-memory cache for the session

- [ ] Task 3: Implement cache-first fetch strategy (AC: 1, 2, 3, 6)
  - [ ] On load, check if cache is valid (less than 5 minutes old)
  - [ ] If cache is valid, return cached config immediately (skip API call)
  - [ ] If cache is expired or missing, proceed to API fetch
  - [ ] When fetching, include `If-None-Match` header with cached ETag (if one exists)

- [ ] Task 4: Handle API response codes (AC: 2, 3)
  - [ ] On 200 OK: parse response JSON, extract ETag from response headers, store both in cache, return config
  - [ ] On 304 Not Modified: use cached config, update cache TTL timestamp, return cached config
  - [ ] On 404 Not Found: agent not found — do NOT use cache, show error state in widget, log `[CodeWeaves] Agent not found (404)`
  - [ ] On 5xx Server Error: log warning, attempt cache fallback if available
  - [ ] On other 4xx: log warning, fall back to cached config if available

- [ ] Task 5: Implement network error fallback (AC: 5)
  - [ ] Wrap fetch in try/catch
  - [ ] Wrap fetch in `Promise.race()` with a 5000ms timeout — treat timeout as a network error and fall back to cache
  - [ ] On network error (fetch throws), attempt to use cached config regardless of TTL
  - [ ] If cached config exists, log warning: `[CodeWeaves] API unreachable, using cached config`
  - [ ] If no cached config exists, log error: `[CodeWeaves] API unreachable and no cached config available`
  - [ ] Return null or throw if no config is available at all

- [ ] Task 6: Implement anti-FOUC loading behavior (AC: 6)
  - [ ] Set widget host element to `opacity: 0` before config is loaded
  - [ ] After config loads successfully, transition to `opacity: 1` with CSS transition
  - [ ] Use `transition: opacity 0.2s ease-in` for smooth fade-in
  - [ ] Ensure the widget never flashes unstyled content
  - [ ] On permanent config failure (no config from API and no cache available), set `opacity: 1` and show a minimal error message — never leave the widget invisible forever

- [ ] Task 7: Write unit tests for config-loader (AC: 1, 2, 3, 4, 5)
  - [ ] Test: returns cached config when TTL is valid (no API call)
  - [ ] Test: sends If-None-Match header when ETag is cached
  - [ ] Test: handles 304 response correctly (uses cache, updates TTL)
  - [ ] Test: handles 200 response correctly (stores new config + ETag)
  - [ ] Test: falls back to cached config on network error
  - [ ] Test: handles missing localStorage gracefully
  - [ ] Test: returns null when no config and no cache available

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
