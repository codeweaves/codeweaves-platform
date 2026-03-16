# Story 10.15: Voice Integration Testing & Provider Health Checks

Status: ready-for-dev

## Story

As a **developer**,
I want voice providers monitored and tested,
So that failures are detected early and routing adapts automatically.

## Acceptance Criteria

1. `GET /voice/providers` returns health status of each provider (healthy/unhealthy, last checked, response time)
2. Health check pings each provider's API on a scheduled interval (every 5 minutes)
3. If a provider is marked unhealthy, VoiceService routing skips it and falls back to the next available provider
4. Provider health status is logged and transitions (healthy→unhealthy, unhealthy→healthy) emit warnings
5. Health check uses lightweight probe requests (not full STT/TTS calls) — e.g., a simple API auth check or small test request
6. Integration test suite exists for each provider that can be run manually against real APIs with test API keys
7. Unit tests cover health check scheduling, provider status tracking, and routing fallback with unhealthy providers
8. Health check failures don't crash the service — individual provider check errors are caught and logged

## Tasks / Subtasks

- [ ] Task 1: Create VoiceProviderHealthService (AC: #1, #2, #5, #8)
  - [ ] 1.1 Create `apps/api/src/modules/voice/voice-provider-health.service.ts`
  - [ ] 1.2 Maintain in-memory health status for each provider:
    ```typescript
    interface ProviderHealthStatus {
      name: string;
      healthy: boolean;
      lastCheckedAt: Date | null;
      lastHealthyAt: Date | null;
      lastError: string | null;
      responseTimeMs: number | null;
      consecutiveFailures: number;
    }
    ```
  - [ ] 1.3 Initialize all providers as healthy on startup (optimistic default)
  - [ ] 1.4 Implement `checkProviderHealth(providerName)` — lightweight probe:
    - **Sarvam**: `GET` to API base URL or a minimal STT request with empty/tiny audio
    - **Deepgram**: `GET https://api.deepgram.com/v1/projects` with API key (auth check)
    - **ElevenLabs**: `GET https://api.elevenlabs.io/v1/user` with API key (auth check)
  - [ ] 1.5 Timeout health probes at 5 seconds — slow response = unhealthy
  - [ ] 1.6 Track `consecutiveFailures` — mark unhealthy after 2 consecutive failures (avoid flapping on transient errors)
  - [ ] 1.7 Mark healthy again on first successful check after being unhealthy
  - [ ] 1.8 Wrap each provider check in try/catch — one provider failing doesn't block others

- [ ] Task 2: Schedule periodic health checks (AC: #2)
  - [ ] 2.1 Use `@nestjs/schedule` package with `@Interval(300_000)` (5 minutes) or `@Cron('*/5 * * * *')`
  - [ ] 2.2 Install `@nestjs/schedule` if not already present: `bun add @nestjs/schedule`
  - [ ] 2.3 Import `ScheduleModule.forRoot()` in `AppModule` (or VoiceModule)
  - [ ] 2.4 Run all three provider checks in parallel on each interval:
    ```typescript
    @Interval(300_000)
    async checkAllProviders() {
      await Promise.allSettled([
        this.checkProviderHealth('sarvam'),
        this.checkProviderHealth('deepgram'),
        this.checkProviderHealth('elevenlabs'),
      ]);
    }
    ```
  - [ ] 2.5 Run initial health check on module init (`onModuleInit`)
  - [ ] 2.6 Skip health checks if provider API key is not configured (provider is permanently unavailable, not unhealthy)

- [ ] Task 3: Logging and observability (AC: #4)
  - [ ] 3.1 Log health check results: `logger.log('Voice provider health: sarvam=healthy (120ms), deepgram=healthy (85ms), elevenlabs=unhealthy (timeout)')`
  - [ ] 3.2 Log state transitions with warnings:
    - `logger.warn('Voice provider sarvam became UNHEALTHY: Connection timeout (2 consecutive failures)')`
    - `logger.log('Voice provider sarvam recovered: healthy after 3 failed checks')`
  - [ ] 3.3 Report provider-down events to Sentry as warnings (not errors — it's a third-party issue):
    ```typescript
    Sentry.captureMessage(`Voice provider ${name} is unhealthy`, {
      level: 'warning',
      extra: { provider: name, consecutiveFailures, lastError },
    });
    ```

- [ ] Task 4: Integrate health status into VoiceService routing (AC: #3)
  - [ ] 4.1 Update `apps/api/src/modules/voice/voice.service.ts`
  - [ ] 4.2 Inject `VoiceProviderHealthService` into VoiceService
  - [ ] 4.3 In `resolveSTTProvider()` and `resolveTTSProvider()`, check provider health before selecting:
    ```typescript
    private resolveSTTProvider(config: VoiceConfig, language: string): VoiceProvider {
      // If agent has forced provider, use it regardless of health (respect explicit choice)
      if (config.sttProvider) {
        return this.sttProviders.get(config.sttProvider)!;
      }

      // Auto-routing considers health
      const preferred = this.getPreferredSTTProvider(language);
      if (this.healthService.isHealthy(preferred)) {
        return this.sttProviders.get(preferred)!;
      }

      // Fallback to any healthy provider
      this.logger.warn(`STT preferred provider ${preferred} unhealthy, falling back`);
      return this.findHealthySTTProvider(language) ?? this.sttProviders.get(preferred)!;
    }
    ```
  - [ ] 4.4 If agent has an explicit provider override (`sttProvider` / `ttsProvider`), use it even if unhealthy — respect the agent owner's explicit choice, let the request fail naturally
  - [ ] 4.5 Auto-routing (no override) skips unhealthy providers and picks the next healthy one

- [ ] Task 5: Update GET /voice/providers endpoint (AC: #1)
  - [ ] 5.1 Update the `/voice/providers` endpoint from story 10-7 to include health status:
    ```typescript
    {
      providers: [
        {
          name: 'sarvam',
          stt: true,
          tts: true,
          languages: ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish', 'en'],
          health: {
            healthy: true,
            lastCheckedAt: '2026-03-14T10:30:00Z',
            responseTimeMs: 120,
          },
        },
        // ...
      ]
    }
    ```
  - [ ] 5.2 Health info is only included when the request comes from an authenticated dashboard user (not public widget requests) — avoid leaking infrastructure status to public

- [ ] Task 6: Integration test suite (AC: #6)
  - [ ] 6.1 Create `apps/api/test/integration/voice/` directory
  - [ ] 6.2 Create `sarvam-provider.integration.spec.ts`:
    - Test real STT with a small test audio file (store in `test/fixtures/test-audio-hi.webm`)
    - Test real TTS with a short Hindi text
    - Skip if `SARVAM_API_KEY` not set: `describe.skipIf(!process.env.SARVAM_API_KEY)`
  - [ ] 6.3 Create `deepgram-provider.integration.spec.ts`:
    - Test real STT with a small English audio file
    - Test TTS throws `UnsupportedLanguageError` for Hindi
    - Skip if `DEEPGRAM_API_KEY` not set
  - [ ] 6.4 Create `elevenlabs-provider.integration.spec.ts`:
    - Test real TTS with short English text
    - Test real STT with a small English audio file
    - Skip if `ELEVENLABS_API_KEY` not set
  - [ ] 6.5 Create test audio fixtures: small WebM files (< 50KB) with clear speech for testing
  - [ ] 6.6 Add npm script: `"test:voice:integration": "jest --testPathPattern=test/integration/voice"` in `apps/api/package.json`

- [ ] Task 7: Unit tests (AC: #7)
  - [ ] 7.1 Create `apps/api/test/services/voice/voice-provider-health.service.spec.ts`
  - [ ] 7.2 Test initial state: all providers healthy
  - [ ] 7.3 Test single check failure: provider stays healthy (need 2 consecutive)
  - [ ] 7.4 Test 2 consecutive failures: provider marked unhealthy
  - [ ] 7.5 Test recovery: unhealthy provider becomes healthy on successful check
  - [ ] 7.6 Test health check timeout: slow response marks provider unhealthy
  - [ ] 7.7 Test one provider failure doesn't affect others
  - [ ] 7.8 Test `checkAllProviders` runs all checks in parallel
  - [ ] 7.9 Update `apps/api/test/services/voice/voice.service.spec.ts`:
    - Test STT routing skips unhealthy provider (auto-routing)
    - Test STT routing uses unhealthy provider when explicitly configured (agent override)
    - Test TTS routing fallback to healthy provider
    - Test all providers unhealthy: still attempts request (last resort)

## Dev Notes

### Health Check Probe Strategy

Use lightweight API calls that verify authentication and connectivity without consuming significant API quota:

| Provider | Probe Request | Expected | Cost |
|----------|--------------|----------|------|
| Sarvam | `GET` to API status endpoint or minimal auth check | 200 OK | Free |
| Deepgram | `GET https://api.deepgram.com/v1/projects` | 200 with projects list | Free |
| ElevenLabs | `GET https://api.elevenlabs.io/v1/user` | 200 with user info | Free |

All three have free "get account info" endpoints that verify the API key is valid and the service is reachable.

```typescript
private async probeSarvam(): Promise<boolean> {
  const response = await fetch('https://api.sarvam.ai/health', { // or appropriate endpoint
    headers: { 'api-subscription-key': this.sarvamApiKey },
    signal: AbortSignal.timeout(5000),
  });
  return response.ok;
}

private async probeDeepgram(): Promise<boolean> {
  const response = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { 'Authorization': `Token ${this.deepgramApiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  return response.ok;
}

private async probeElevenLabs(): Promise<boolean> {
  const response = await fetch('https://api.elevenlabs.io/v1/user', {
    headers: { 'xi-api-key': this.elevenLabsApiKey },
    signal: AbortSignal.timeout(5000),
  });
  return response.ok;
}
```

### Consecutive Failure Threshold

Mark unhealthy only after 2 consecutive failures. This avoids flapping from transient network issues:

```
Check 1: fail  → consecutiveFailures: 1, status: healthy (still)
Check 2: fail  → consecutiveFailures: 2, status: UNHEALTHY
Check 3: fail  → consecutiveFailures: 3, status: unhealthy
Check 4: pass  → consecutiveFailures: 0, status: HEALTHY (recovered)
```

### Routing with Health Awareness

Auto-routing (no agent override) checks health. Explicit override ignores health:

```
Agent has sttProvider: 'deepgram' (explicit)
  → ALWAYS use Deepgram, even if unhealthy (agent owner chose it)

Agent has sttProvider: null (auto-route)
  → Hindi detected → prefer Sarvam
  → Sarvam unhealthy? → try Deepgram
  → Deepgram unhealthy? → try ElevenLabs
  → All unhealthy? → try Sarvam anyway (last resort, may work)
```

### Unconfigured vs Unhealthy

If a provider's API key is not set in environment variables, the provider is **unconfigured** (permanently unavailable), not unhealthy. Don't run health checks on unconfigured providers:

```typescript
private isConfigured(provider: string): boolean {
  switch (provider) {
    case 'sarvam': return !!this.configService.get('SARVAM_API_KEY');
    case 'deepgram': return !!this.configService.get('DEEPGRAM_API_KEY');
    case 'elevenlabs': return !!this.configService.get('ELEVENLABS_API_KEY');
    default: return false;
  }
}
```

### Integration Tests

Integration tests hit real APIs and are **not** run in CI. They require real API keys and are meant for manual verification during development or before releases.

```typescript
// test/integration/voice/sarvam-provider.integration.spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const SKIP = !process.env.SARVAM_API_KEY;

describe.skipIf(SKIP)('SarvamProvider (integration)', () => {
  it('should transcribe Hindi audio', async () => {
    const audio = readFileSync(join(__dirname, '../../fixtures/test-audio-hi.webm'));
    const result = await provider.transcribe({
      audio,
      format: 'webm',
      language: 'hi',
      agentId: 'test-agent',
    });
    expect(result.text).toBeTruthy();
    expect(result.detectedLanguage).toBe('hi');
  });
});
```

### @nestjs/schedule Setup

If `@nestjs/schedule` is not already installed:

```bash
cd apps/api && bun add @nestjs/schedule
```

In `AppModule` or `VoiceModule`:
```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), ...],
})
```

### What NOT to Do

- **Do NOT** run integration tests in CI — they require real API keys and cost real money
- **Do NOT** use full STT/TTS calls as health probes — too expensive and slow
- **Do NOT** mark a provider unhealthy on a single failure — use 2 consecutive failures
- **Do NOT** skip unhealthy providers when agent has an explicit override — respect the owner's choice
- **Do NOT** persist health status to database — in-memory is fine, resets on restart with optimistic defaults
- **Do NOT** expose provider health status in public/widget-facing endpoints — only for authenticated dashboard users

### Dependencies

- **Requires stories 10-1 through 10-5** (provider implementations, VoiceService)
- **Requires story 10-7** (GET /voice/providers endpoint to extend)
- Uses `@nestjs/schedule` for interval-based health checks
- Uses existing Sentry integration for health event reporting
- Uses existing `ConfigService` for API key access

### Project Structure Notes

- Health service: `apps/api/src/modules/voice/voice-provider-health.service.ts` (new)
- VoiceService update: `apps/api/src/modules/voice/voice.service.ts` (modify routing)
- VoiceModule update: `apps/api/src/modules/voice/voice.module.ts` (add health service, schedule)
- Controller update: `apps/api/src/modules/voice/voice.controller.ts` (extend /providers endpoint)
- Integration tests: `apps/api/test/integration/voice/*.integration.spec.ts` (new)
- Test fixtures: `apps/api/test/fixtures/test-audio-*.webm` (new)
- Unit tests: `apps/api/test/services/voice/voice-provider-health.service.spec.ts` (new)

### References

- [Architecture: Section 20.15 - Provider Health Checks](_bmad-output/planning-artifacts/architecture.md)
- [Health controller](apps/api/src/modules/health/health.controller.ts) — existing pattern
- [Story 12-3: Health Check Endpoint](_bmad-output/implementation-artifacts/12-3-health-check-endpoint-liveness.md) — health check pattern
- [Story 10-5: VoiceService Routing](_bmad-output/implementation-artifacts/10-5-voice-service-language-based-provider-routing.md) — routing logic to extend
- [Story 10-7: Voice Controller](_bmad-output/implementation-artifacts/10-7-voice-controller-full-conversation-endpoint.md) — /providers endpoint

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
