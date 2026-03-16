# Story 10.1: Voice Provider Interface & Adapter Foundation

Status: ready-for-dev

## Story

As a **developer**,
I want a provider-agnostic voice interface with adapter implementations,
So that STT/TTS providers can be swapped without changing business logic.

## Acceptance Criteria

1. `VoiceProvider` interface is defined with `transcribe()`, `synthesize()`, and `detectLanguage()` methods
2. `STTRequest`, `STTResponse`, `TTSRequest`, `TTSResponse` types are defined with `latencyMs` and `provider` metadata
3. `VoiceModule` is created with proper NestJS module structure
4. Provider implementations are injectable via NestJS DI
5. A provider registry (`Map<string, VoiceProvider>`) holds all registered providers
6. Zod validation schema for voice DTOs exists in `packages/validation`
7. Unit tests verify the interface contracts and module wiring

## Tasks / Subtasks

- [ ] Task 1: Create VoiceProvider interface and types (AC: #1, #2)
  - [ ] 1.1 Create `apps/api/src/modules/voice/providers/voice-provider.interface.ts`
  - [ ] 1.2 Define `STTRequest`, `STTResponse`, `TTSRequest`, `TTSResponse`, `LanguageDetectionResponse` interfaces
  - [ ] 1.3 Define `VoiceProvider` abstract interface with `transcribe()`, `synthesize()`, `detectLanguage()`, `name`, `supportedLanguages`
  - [ ] 1.4 Define `VoiceProviderError` class extending NestJS exceptions

- [ ] Task 2: Create Zod validation schemas (AC: #6)
  - [ ] 2.1 Create `packages/validation/src/voice.ts`
  - [ ] 2.2 Define `voiceConversationSchema` for the `/voice/conversation` endpoint
  - [ ] 2.3 Define `transcribeSchema`, `synthesizeSchema` for individual endpoints
  - [ ] 2.4 Define `voiceConfigSchema` for agent voice configuration
  - [ ] 2.5 Export from `packages/validation/src/index.ts`

- [ ] Task 3: Create VoiceModule with DI wiring (AC: #3, #4, #5)
  - [ ] 3.1 Create `apps/api/src/modules/voice/voice.module.ts`
  - [ ] 3.2 Create `apps/api/src/modules/voice/voice.service.ts` with provider registry
  - [ ] 3.3 Create `apps/api/src/modules/voice/voice.controller.ts` with stub endpoints
  - [ ] 3.4 Create `apps/api/src/modules/voice/dto/` directory with DTOs
  - [ ] 3.5 Register VoiceModule in `apps/api/src/modules/app.module.ts`

- [ ] Task 4: Create stub provider for testing (AC: #5, #7)
  - [ ] 4.1 Create `apps/api/src/modules/voice/providers/stub.provider.ts` — returns mock responses for dev/testing
  - [ ] 4.2 Register stub provider in VoiceModule as default

- [ ] Task 5: Unit tests (AC: #7)
  - [ ] 5.1 Create `apps/api/test/services/voice/voice.service.spec.ts`
  - [ ] 5.2 Test provider registry (register, get, unknown provider error)
  - [ ] 5.3 Test VoiceService routing logic (delegates to correct provider)
  - [ ] 5.4 Test stub provider returns valid responses

## Dev Notes

### Architecture Context

Voice is a **transport-layer concern** — it wraps the existing text chat flow. STT converts audio→text (pre-processing), TTS converts text→audio (post-processing). The AI/orchestration layer (n8n) never knows voice is involved.

**Key constraint:** n8n does not support streaming. Full response must be received before TTS begins.

**Architecture reference:** Section 20 of `_bmad-output/planning-artifacts/architecture.md` (v1.1.0), ADR-011.

### Codebase Patterns to Follow

**Module structure** — mirror existing patterns:
```
apps/api/src/modules/voice/
├── voice.module.ts          # Module definition
├── voice.service.ts         # Business logic + provider routing
├── voice.controller.ts      # HTTP endpoints
├── dto/                     # Request/response DTOs
│   ├── voice-conversation.dto.ts
│   ├── transcribe.dto.ts
│   └── synthesize.dto.ts
└── providers/
    ├── voice-provider.interface.ts  # Provider contract
    └── stub.provider.ts             # Test/dev provider
```

**There is NO existing AI provider interface** to mirror. The current n8n integration in `apps/api/src/services/chat.service.ts` calls webhooks directly via `fetch()`. This story establishes the first formal provider adapter pattern in the codebase.

**NestJS module pattern** (from `apps/api/src/modules/chat.module.ts`):
```typescript
@Module({
  imports: [PrismaModule],
  controllers: [VoiceController],
  providers: [VoiceService, StubProvider],
  exports: [VoiceService],
})
export class VoiceModule {}
```

**Service injection** — constructor DI:
```typescript
constructor(
  private readonly voiceService: VoiceService,
) {}
```

**Validation pattern** — Zod + pipe:
```typescript
@Body(new ZodValidationPipe(transcribeSchema)) dto: TranscribeDto
```

**Controller pattern** — use `@Public()` decorator for widget-facing endpoints (no JWT required). Reference `apps/api/src/controllers/public/public-chat.controller.ts`.

**Error handling** — use NestJS built-in exceptions:
```typescript
throw new BadGatewayException('Voice provider error');
throw new BadRequestException('Unsupported audio format');
```

**Logger** — each service gets its own:
```typescript
private readonly logger = new Logger(VoiceService.name);
```

**Config access** — via `ConfigService`:
```typescript
constructor(private readonly configService: ConfigService) {}
const apiKey = this.configService.get<string>('SARVAM_API_KEY');
```

### Provider Interface Design

The interface must support these three providers (implemented in subsequent stories):

| Provider | Auth Header | STT Input | TTS Output | Language Codes |
|----------|------------|-----------|------------|----------------|
| **Sarvam AI** | `api-subscription-key: <key>` | multipart/form-data | Base64 JSON (`audios[]`) | BCP-47: `hi-IN`, `mr-IN`, `en-IN` |
| **Deepgram** | `Authorization: Token <key>` | binary body | N/A (no Indian TTS) | ISO 639-1: `hi`, `mr`, `en` |
| **ElevenLabs** | `xi-api-key: <key>` | multipart/form-data | Raw binary stream | ISO 639-1: `hi`, `mr`, `en` |

**Critical:** Language codes differ between providers. The interface must use a **normalized internal format** (ISO 639-1: `hi`, `mr`, `en`, `hinglish`) and each provider adapter will map to its own format internally.

**Audio formats:** Browser `MediaRecorder` outputs `audio/webm` by default. Providers accept different formats. The interface should accept `Buffer` + format string; providers handle conversion if needed.

### Zod Schema Design

```typescript
// packages/validation/src/voice.ts
export const voiceProviderEnum = z.enum(['sarvam', 'deepgram', 'elevenlabs']);

export const voiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sttEnabled: z.boolean().default(true),
  ttsEnabled: z.boolean().default(true),
  sttProvider: voiceProviderEnum.optional(),
  ttsProvider: voiceProviderEnum.optional(),
  defaultLanguage: z.string().default('en'),
  supportedLanguages: z.array(z.string()).default(['en']),
  ttsVoiceId: z.string().optional(),
  ttsSpeed: z.number().min(0.5).max(2.0).default(1.0),
  autoDetectLanguage: z.boolean().default(true),
});

export const voiceConversationSchema = z.object({
  agentId: z.string(),
  deviceId: z.string().optional(),
  sessionId: z.string().optional(),
  languageHint: z.string().optional(),
});

export const transcribeSchema = z.object({
  agentId: z.string(),
  languageHint: z.string().optional(),
});

export const synthesizeSchema = z.object({
  text: z.string().min(1).max(5000),
  language: z.string(),
  voiceId: z.string().optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  agentId: z.string(),
});
```

### Environment Variables (for future stories)

Add to `.env.example` (but don't require values for this story — stub provider has no external deps):
```
# Voice Providers (Epic 10)
SARVAM_API_KEY=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
```

### Test Patterns

Follow existing test structure in `apps/api/test/services/`:
```typescript
describe('VoiceService', () => {
  let service: VoiceService;
  const mockStubProvider = { name: 'stub', transcribe: jest.fn(), synthesize: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: 'STUB_PROVIDER', useValue: mockStubProvider },
      ],
    }).compile();
    service = module.get(VoiceService);
  });
});
```

### What NOT to Do

- **Do NOT** implement real provider adapters (Sarvam, Deepgram, ElevenLabs) — those are stories 10-2, 10-3, 10-4
- **Do NOT** add database migrations — that's story 10-6
- **Do NOT** implement the full `/voice/conversation` flow — that's story 10-7
- **Do NOT** touch the widget — that's stories 10-8, 10-9
- **Do NOT** create a `providers/` directory under `common/` — keep voice providers inside `modules/voice/providers/` following module encapsulation

### Project Structure Notes

- Voice module lives at `apps/api/src/modules/voice/` — NOT in `common/`
- Zod schemas go in `packages/validation/src/voice.ts` — shared between frontend and backend
- Tests go in `apps/api/test/services/voice/`
- Follows NestJS convention: module, controller, service, DTOs co-located

### References

- [Architecture: Section 20 - Voice Architecture](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: ADR-011 - Voice Provider Adapter Pattern](_bmad-output/planning-artifacts/architecture.md)
- [PRD: FR135-FR149 - Voice Requirements](_bmad-output/planning-artifacts/prd.md)
- [Existing module pattern](apps/api/src/modules/chat.module.ts)
- [Existing controller pattern](apps/api/src/controllers/public/public-chat.controller.ts)
- [Existing validation pattern](packages/validation/src/chat.ts)
- [Existing test pattern](apps/api/test/services/chat/chat.service.spec.ts)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
