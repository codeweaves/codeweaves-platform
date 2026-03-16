# Story 10.5: Voice Service — Language-Based Provider Routing

Status: ready-for-dev

## Story

As a **developer**,
I want a voice service that auto-routes to the best provider based on language,
So that each language gets optimal transcription and synthesis quality.

## Acceptance Criteria

1. `VoiceService` resolves the correct STT provider using language-based routing:
   - Indian languages (hi, mr, bn, ta, te, gu, kn, ml, pa, or, hinglish) → Sarvam AI
   - English-dominant → Deepgram
2. `VoiceService` resolves the correct TTS provider using language-based routing:
   - Indian languages → Sarvam AI
   - English-dominant → ElevenLabs
3. Per-agent overrides from `voiceConfig.sttProvider` / `voiceConfig.ttsProvider` take precedence over auto-routing
4. If a provider doesn't support TTS for a language (e.g., Deepgram), it falls back to next available provider
5. Routing decisions are logged for observability
6. `VoiceService.transcribe()` and `VoiceService.synthesize()` are the public API — callers never interact with providers directly
7. Unit tests verify routing for each language, override combinations, and fallback scenarios

## Tasks / Subtasks

- [ ] Task 1: Refactor VoiceService provider registry (AC: #1, #2, #6)
  - [ ] 1.1 Update `apps/api/src/modules/voice/voice.service.ts`
  - [ ] 1.2 Inject all three providers: `SarvamProvider`, `DeepgramProvider`, `ElevenLabsProvider`
  - [ ] 1.3 Create separate STT and TTS provider maps (not all providers support both)
  - [ ] 1.4 Expose public `transcribe(request)` and `synthesize(request)` methods that resolve provider internally

- [ ] Task 2: Implement STT routing logic (AC: #1, #3)
  - [ ] 2.1 Create `private resolveSTTProvider(voiceConfig, language): VoiceProvider`
  - [ ] 2.2 Priority: agent override (`voiceConfig.sttProvider`) → language-based routing → default
  - [ ] 2.3 Indian languages list: `['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish']`
  - [ ] 2.4 Indian languages → Sarvam, English/other → Deepgram

- [ ] Task 3: Implement TTS routing logic (AC: #2, #3, #4)
  - [ ] 3.1 Create `private resolveTTSProvider(voiceConfig, language): VoiceProvider`
  - [ ] 3.2 Priority: agent override (`voiceConfig.ttsProvider`) → language-based routing → default
  - [ ] 3.3 Indian languages → Sarvam, English/other → ElevenLabs
  - [ ] 3.4 Handle `UnsupportedLanguageError` from providers — catch and try next provider in fallback chain
  - [ ] 3.5 Fallback chain for TTS: configured provider → Sarvam (broadest Indian coverage) → ElevenLabs → error

- [ ] Task 4: Fetch agent voice config (AC: #3)
  - [ ] 4.1 Create `private getVoiceConfig(agentId): Promise<VoiceConfig>`
  - [ ] 4.2 Query agent's `voiceConfig` JSONB field via PrismaService (or AgentsService)
  - [ ] 4.3 Parse with `voiceConfigSchema` from `packages/validation`
  - [ ] 4.4 Return defaults if agent has no voice config or voice is disabled
  - [ ] 4.5 Cache voice config per request (fetch once, reuse for STT + TTS in same conversation)

- [ ] Task 5: Implement `detectLanguage()` delegation (AC: #6)
  - [ ] 5.1 Create public `detectLanguage(audio, agentId)` method
  - [ ] 5.2 Route to Sarvam by default (best Indian language detection with `language_code: 'unknown'`)
  - [ ] 5.3 Return detected language and confidence

- [ ] Task 6: Observability logging (AC: #5)
  - [ ] 6.1 Log routing decisions: `logger.log('STT routing: language=${lang}, provider=${provider.name}, override=${hasOverride}')`
  - [ ] 6.2 Log fallback events: `logger.warn('TTS fallback: ${originalProvider} → ${fallbackProvider}, reason: ${error.message}')`
  - [ ] 6.3 Log latency per provider call

- [ ] Task 7: Update VoiceModule wiring (AC: #6)
  - [ ] 7.1 Import `AgentsModule` (or `PrismaModule`) in VoiceModule for voice config lookup
  - [ ] 7.2 Ensure all three providers + VoiceService are properly wired in module

- [ ] Task 8: Unit tests (AC: #7)
  - [ ] 8.1 Update `apps/api/test/services/voice/voice.service.spec.ts`
  - [ ] 8.2 Test STT routing: Hindi → Sarvam, English → Deepgram
  - [ ] 8.3 Test TTS routing: Hindi → Sarvam, English → ElevenLabs
  - [ ] 8.4 Test agent override: `sttProvider: 'elevenlabs'` forces ElevenLabs for STT regardless of language
  - [ ] 8.5 Test TTS fallback: Deepgram throws `UnsupportedLanguageError` → falls back to Sarvam
  - [ ] 8.6 Test all Indian languages route to Sarvam
  - [ ] 8.7 Test `hinglish` routes to Sarvam
  - [ ] 8.8 Test missing/disabled voice config returns defaults
  - [ ] 8.9 Test voice config is fetched once per request (not per provider call)

## Dev Notes

### Routing Logic Summary

```
┌─────────────────────────────────────────────────┐
│              STT ROUTING                         │
│                                                  │
│  1. Agent override? → use voiceConfig.sttProvider│
│  2. Indian lang?    → Sarvam AI                  │
│  3. Default         → Deepgram                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              TTS ROUTING                         │
│                                                  │
│  1. Agent override? → use voiceConfig.ttsProvider│
│  2. Indian lang?    → Sarvam AI                  │
│  3. Default         → ElevenLabs                 │
│                                                  │
│  FALLBACK (on UnsupportedLanguageError):         │
│  Configured → Sarvam → ElevenLabs → throw error  │
└─────────────────────────────────────────────────┘
```

**Indian languages constant:**
```typescript
private readonly INDIAN_LANGUAGES = new Set([
  'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish',
]);
```

### Implementation Pattern

```typescript
@Injectable()
export class VoiceService {
  private readonly sttProviders: Map<string, VoiceProvider>;
  private readonly ttsProviders: Map<string, VoiceProvider>;
  private readonly logger = new Logger(VoiceService.name);

  private readonly INDIAN_LANGUAGES = new Set([
    'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish',
  ]);

  constructor(
    private readonly sarvamProvider: SarvamProvider,
    private readonly deepgramProvider: DeepgramProvider,
    private readonly elevenLabsProvider: ElevenLabsProvider,
    private readonly prisma: PrismaService,
  ) {
    this.sttProviders = new Map([
      ['sarvam', sarvamProvider],
      ['deepgram', deepgramProvider],
      ['elevenlabs', elevenLabsProvider],
    ]);
    this.ttsProviders = new Map([
      ['sarvam', sarvamProvider],
      ['elevenlabs', elevenLabsProvider],
      // Deepgram intentionally excluded — no Indian TTS
    ]);
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveSTTProvider(config, request.language);
    this.logger.log(`STT routing: language=${request.language}, provider=${provider.name}`);
    return provider.transcribe(request);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    try {
      const provider = this.resolveTTSProvider(config, request.language);
      this.logger.log(`TTS routing: language=${request.language}, provider=${provider.name}`);
      return await provider.synthesize(request);
    } catch (error) {
      if (error instanceof UnsupportedLanguageError) {
        return this.ttsFallback(request, config, error);
      }
      throw error;
    }
  }
}
```

### TTS Fallback Chain

When a provider throws `UnsupportedLanguageError` (e.g., Deepgram for Hindi TTS), the service tries the next provider:

```typescript
private async ttsFallback(
  request: TTSRequest,
  config: VoiceConfig,
  originalError: UnsupportedLanguageError,
): Promise<TTSResponse> {
  const fallbackOrder = ['sarvam', 'elevenlabs'];

  for (const providerName of fallbackOrder) {
    if (providerName === originalError.provider) continue; // skip the one that failed
    const provider = this.ttsProviders.get(providerName);
    if (!provider) continue;

    try {
      this.logger.warn(`TTS fallback: ${originalError.provider} → ${providerName}`);
      return await provider.synthesize(request);
    } catch (e) {
      if (e instanceof UnsupportedLanguageError) continue;
      throw e;
    }
  }

  throw new BadGatewayException(
    `No TTS provider supports language: ${request.language}`,
  );
}
```

### Voice Config Fetching

Query the agent's `voiceConfig` JSONB column. This is a lightweight query — just one field from one row.

```typescript
private async getVoiceConfig(agentId: string): Promise<VoiceConfig> {
  const agent = await this.prisma.agent.findUnique({
    where: { id: agentId },
    select: { voiceConfig: true, voiceEnabled: true },
  });

  if (!agent || !agent.voiceEnabled || !agent.voiceConfig) {
    return DEFAULT_VOICE_CONFIG; // sensible defaults from voiceConfigSchema
  }

  return voiceConfigSchema.parse(agent.voiceConfig);
}
```

**Note:** The `voiceConfig` JSONB column doesn't exist yet — it's added in story 10-6. For this story, implement the `getVoiceConfig()` method but handle the case where the column doesn't exist (return defaults). This allows stories 10-5 and 10-6 to be developed in parallel or in either order.

### Existing Codebase Patterns

**Service injection pattern** (from `apps/api/src/services/chat.service.ts`):
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly agentsService: AgentsService,
) {}
```

**Logger pattern:**
```typescript
private readonly logger = new Logger(VoiceService.name);
```

**Error handling** (from `chat.service.ts`):
```typescript
throw new BadGatewayException('AI service returned an error');
```

### What NOT to Do

- **Do NOT** implement the voice controller endpoints — that's story 10-7
- **Do NOT** add database migrations for voiceConfig — that's story 10-6
- **Do NOT** implement provider health checks — that's story 10-15
- **Do NOT** add caching layers beyond per-request config caching — premature optimization
- **Do NOT** implement WebSocket/streaming — n8n doesn't support it
- **Do NOT** make routing async or call external services for routing decisions — it's a pure in-memory lookup

### Dependencies

- **Requires stories 10-1, 10-2, 10-3, 10-4** (interface + all three providers)
- Uses `VoiceProvider` interface, `UnsupportedLanguageError` from 10-1
- Uses `SarvamProvider` from 10-2, `DeepgramProvider` from 10-3, `ElevenLabsProvider` from 10-4
- **Soft dependency on 10-6** (voice config schema in DB) — implement with fallback to defaults if column doesn't exist yet

### Project Structure Notes

- Main file: `apps/api/src/modules/voice/voice.service.ts` (update existing from 10-1)
- Module file: `apps/api/src/modules/voice/voice.module.ts` (update imports)
- Test file: `apps/api/test/services/voice/voice.service.spec.ts` (update existing from 10-1)

### References

- [Architecture: Section 20.4 - Voice Service (Router + Orchestrator)](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: Section 20.9 - Voice Provider Comparison & Routing](_bmad-output/planning-artifacts/architecture.md)
- [Story 10-1: Voice Provider Interface](_bmad-output/implementation-artifacts/10-1-voice-provider-interface-adapter-foundation.md)
- [Story 10-2: Sarvam Provider](_bmad-output/implementation-artifacts/10-2-sarvam-ai-provider-implementation.md)
- [Story 10-3: Deepgram Provider](_bmad-output/implementation-artifacts/10-3-deepgram-provider-implementation.md)
- [Story 10-4: ElevenLabs Provider](_bmad-output/implementation-artifacts/10-4-elevenlabs-provider-implementation.md)
- [Existing service pattern](apps/api/src/services/chat.service.ts)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
