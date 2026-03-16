# Story 10.4: ElevenLabs Provider Implementation

Status: ready-for-dev

## Story

As a **developer**,
I want an ElevenLabs adapter for premium TTS and STT,
So that English and supported Indian languages get high-quality voice synthesis.

## Acceptance Criteria

1. `ElevenLabsProvider` implements `VoiceProvider` interface from story 10-1
2. TTS calls ElevenLabs Multilingual v2 API (`POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`)
3. STT calls ElevenLabs Scribe v2 API (`POST https://api.elevenlabs.io/v1/speech-to-text`)
4. `supportedLanguages` includes: en, hi, mr, bn, gu, ml, ta, te
5. Voice ID is configurable per-agent via `voiceConfig.ttsVoiceId`
6. API key is stored in environment config (`ELEVENLABS_API_KEY`)
7. Error responses are mapped to standard NestJS exceptions
8. Latency is tracked per request
9. Unit tests mock ElevenLabs API responses for STT and TTS

## Tasks / Subtasks

- [ ] Task 1: Create ElevenLabsProvider class (AC: #1, #4)
  - [ ] 1.1 Create `apps/api/src/modules/voice/providers/elevenlabs.provider.ts`
  - [ ] 1.2 Implement `VoiceProvider` interface — `name`, `supportedLanguages`, `transcribe()`, `synthesize()`, `detectLanguage()`
  - [ ] 1.3 Define default voice ID constant (fallback when none configured)
  - [ ] 1.4 Make it `@Injectable()` for NestJS DI

- [ ] Task 2: Implement TTS — `synthesize()` (AC: #2, #5, #8)
  - [ ] 2.1 Resolve voice ID: use `request.voiceId` (from agent config) or fall back to default
  - [ ] 2.2 Build JSON body with `text`, `model_id` (`eleven_multilingual_v2`), `language_code`, `voice_settings`
  - [ ] 2.3 Send `POST` to `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
  - [ ] 2.4 Set auth header: `xi-api-key: <ELEVENLABS_API_KEY>`
  - [ ] 2.5 **CRITICAL:** Response is raw binary audio (`application/octet-stream`), NOT JSON. Read with `response.arrayBuffer()` → `Buffer.from()`
  - [ ] 2.6 Track latency
  - [ ] 2.7 Return `TTSResponse` with audio buffer, format (`mp3`), durationMs, latencyMs, provider

- [ ] Task 3: Implement STT — `transcribe()` (AC: #3, #8)
  - [ ] 3.1 Build `FormData` with audio file, `model_id` (`scribe_v2`), optional `language_code`
  - [ ] 3.2 Send `POST` to `https://api.elevenlabs.io/v1/speech-to-text`
  - [ ] 3.3 Set auth header: `xi-api-key: <ELEVENLABS_API_KEY>`
  - [ ] 3.4 Parse response: extract `text`, `language_code`, `language_probability`
  - [ ] 3.5 Track latency
  - [ ] 3.6 Return `STTResponse`

- [ ] Task 4: Implement `detectLanguage()` (AC: #1)
  - [ ] 4.1 Use STT without `language_code` to auto-detect
  - [ ] 4.2 Return `language_code` and `language_probability` from response

- [ ] Task 5: Error handling (AC: #7)
  - [ ] 5.1 Map ElevenLabs errors to NestJS exceptions:
    - 401 → `UnauthorizedException`
    - 422 (`detail.status`) → `BadRequestException`
    - 429 → `TooManyRequestsException`
    - 500/502/503 → `BadGatewayException`
  - [ ] 5.2 Handle network timeouts (15s for TTS — ElevenLabs is slower ~0.9s) with `AbortSignal.timeout(15_000)`
  - [ ] 5.3 Log errors with provider name and request context

- [ ] Task 6: Register provider in VoiceModule (AC: #1)
  - [ ] 6.1 Add `ElevenLabsProvider` to VoiceModule providers array
  - [ ] 6.2 Register in VoiceService provider registry under key `'elevenlabs'`

- [ ] Task 7: Add environment config (AC: #6)
  - [ ] 7.1 Add `ELEVENLABS_API_KEY` to `.env.example`
  - [ ] 7.2 Add `ELEVENLABS_DEFAULT_VOICE_ID` to `.env.example` (optional, fallback voice)
  - [ ] 7.3 Validate API key is present on provider initialization (log warning if missing)

- [ ] Task 8: Unit tests (AC: #9)
  - [ ] 8.1 Create `apps/api/test/services/voice/elevenlabs.provider.spec.ts`
  - [ ] 8.2 Mock `fetch` — test successful TTS response parsing (raw binary → Buffer)
  - [ ] 8.3 Mock `fetch` — test successful STT response parsing
  - [ ] 8.4 Test voice ID resolution (agent config → default fallback)
  - [ ] 8.5 Test auth header uses `xi-api-key`
  - [ ] 8.6 Test error mapping (HTTP status → NestJS exceptions)
  - [ ] 8.7 Test timeout handling (15s for TTS)
  - [ ] 8.8 Test `detectLanguage()` omits language_code for auto-detect

## Dev Notes

### ElevenLabs API Reference

**Base URL:** `https://api.elevenlabs.io`
**Auth:** `xi-api-key: <ELEVENLABS_API_KEY>` header on every request
**SDK available** (`@elevenlabs/elevenlabs-js`) but use `fetch` directly for consistency with other providers.
**Regional endpoints available:** `api.in.residency.elevenlabs.io` (India) — consider for lower latency to Indian users (future optimization).

#### TTS Endpoint

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
Content-Type: application/json
xi-api-key: <key>
```

**CRITICAL:** Voice ID goes in the **URL path**, not the request body.

**Request body:**
```typescript
interface ElevenLabsTTSRequest {
  text: string;                    // Required
  model_id: string;                // 'eleven_multilingual_v2' for multi-language
  language_code?: string;          // ISO 639-1: 'hi', 'mr', 'en'
  voice_settings?: {
    stability: number;             // 0-1, default 0.5
    similarity_boost: number;      // 0-1, default 0.75
    style?: number;                // 0-1, default 0
    speed?: number;                // Maps from ttsSpeed in voiceConfig
  };
}
```

**Output format options (query param):**
- `mp3_44100_128` — good default for web playback
- `mp3_22050_32` — smaller file, lower quality
- `pcm_16000` — raw PCM
- `opus_48000` — smallest size, good quality

**Response:** Raw binary audio (`application/octet-stream`) — **NOT JSON, NOT base64**

```typescript
// CORRECT way to read ElevenLabs TTS response:
const arrayBuffer = await response.arrayBuffer();
const audioBuffer = Buffer.from(arrayBuffer);
// audioBuffer is ready to send to client
```

This is different from Sarvam (base64 in JSON) — no decoding needed, just read the binary stream.

**Key model IDs:**
| Model | Use Case | Latency |
|-------|----------|---------|
| `eleven_multilingual_v2` | Best for multilingual (Hindi, Marathi, etc.) | ~0.9s |
| `eleven_turbo_v2_5` | Lower latency, English-focused | ~0.3s |

**Voice IDs** are opaque strings like `Xb7hH8MSUJpSbSDYk0k2`. To list available voices:
```
GET https://api.elevenlabs.io/v2/voices
xi-api-key: <key>
```

#### STT Endpoint (Scribe)

```
POST https://api.elevenlabs.io/v1/speech-to-text
Content-Type: multipart/form-data
xi-api-key: <key>
```

**Form fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | binary | Yes | Audio file (< 3GB) |
| `model_id` | string | Yes | `scribe_v2` |
| `language_code` | string | No | ISO 639-1, omit for auto-detect |
| `tag_audio_events` | boolean | No | Default true — tags laughter, music, etc. |

**Response:**
```typescript
interface ElevenLabsSTTResponse {
  language_code: string;           // Detected language
  language_probability: number;    // 0-1
  text: string;                    // Full transcript
  words: Array<{
    text: string;
    start: number;
    end: number;
    type: 'word' | 'spacing' | 'audio_event';
    speaker_id?: string;
  }>;
}
```

#### Error Response

```typescript
// 422 errors:
interface ElevenLabsError {
  detail: {
    status: string;     // e.g. 'invalid_request'
    message: string;
  };
}

// 401 errors:
interface ElevenLabsAuthError {
  detail: {
    status: string;
    message: string;    // e.g. 'Invalid API key'
  };
}
```

### Key Differences from Other Providers

| Aspect | Sarvam | Deepgram | ElevenLabs |
|--------|--------|----------|------------|
| TTS output | Base64 in JSON | N/A | **Raw binary stream** |
| STT input | FormData | Raw binary | FormData |
| Auth header | `api-subscription-key` | `Authorization: Token` | `xi-api-key` |
| Language codes | BCP-47 (`hi-IN`) | ISO 639-1 (`hi`) | ISO 639-1 (`hi`) |
| TTS voice selection | `speaker` in body | N/A | `voice_id` in **URL path** |
| TTS latency | ~0.4s | N/A | ~0.9s |
| TTS timeout | 10s | N/A | **15s** (slower provider) |

### Implementation Pattern

```typescript
@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs';
  readonly supportedLanguages = ['en', 'hi', 'mr', 'bn', 'gu', 'ml', 'ta', 'te'];

  private readonly apiKey: string;
  private readonly defaultVoiceId: string;
  private readonly logger = new Logger(ElevenLabsProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY') || '';
    this.defaultVoiceId = this.configService.get<string>('ELEVENLABS_DEFAULT_VOICE_ID') || 'Xb7hH8MSUJpSbSDYk0k2';

    if (!this.apiKey) {
      this.logger.warn('ELEVENLABS_API_KEY not configured — ElevenLabs provider will not work');
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const voiceId = request.voiceId || this.defaultVoiceId;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: 'eleven_multilingual_v2',
          language_code: request.language,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: request.speed || 1.0,
          },
        }),
        signal: AbortSignal.timeout(15_000), // 15s — ElevenLabs is slower
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw this.mapError(response.status, error);
    }

    // CRITICAL: Raw binary response, not JSON
    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      format: 'mp3',
      durationMs: 0, // Can't determine without parsing audio
      latencyMs: Date.now() - startTime,
      provider: this.name,
    };
  }
}
```

### What NOT to Do

- **Do NOT** use `@elevenlabs/elevenlabs-js` SDK — use `fetch` for consistency
- **Do NOT** try to parse TTS response as JSON — it's raw binary audio
- **Do NOT** put voice_id in the request body — it goes in the URL path
- **Do NOT** implement routing logic — that's story 10-5
- **Do NOT** implement voice listing endpoint — out of scope, voice IDs are configured per-agent
- **Do NOT** use 10s timeout for TTS — ElevenLabs needs 15s (P90 ~0.9s, but can spike)

### Dependencies

- **Requires story 10-1** (VoiceProvider interface) to be completed first
- Uses `VoiceProvider`, `STTRequest`, `STTResponse`, `TTSRequest`, `TTSResponse` from 10-1

### Project Structure Notes

- Provider file: `apps/api/src/modules/voice/providers/elevenlabs.provider.ts`
- Test file: `apps/api/test/services/voice/elevenlabs.provider.spec.ts`
- Env vars: `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` in `.env.example`

### References

- [Architecture: Section 20.3 - Provider Implementations](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: Section 20.9 - Voice Provider Comparison](_bmad-output/planning-artifacts/architecture.md)
- [ElevenLabs TTS API Docs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [ElevenLabs STT API Docs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
- [ElevenLabs Voices List](https://elevenlabs.io/docs/api-reference/voices/search)
- [Story 10-1: Voice Provider Interface](_bmad-output/implementation-artifacts/10-1-voice-provider-interface-adapter-foundation.md)
- [Story 10-2: Sarvam Provider](_bmad-output/implementation-artifacts/10-2-sarvam-ai-provider-implementation.md) — reference for consistent patterns
- [Story 10-3: Deepgram Provider](_bmad-output/implementation-artifacts/10-3-deepgram-provider-implementation.md) — reference for consistent patterns
- [Existing fetch pattern](apps/api/src/services/chat.service.ts)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
