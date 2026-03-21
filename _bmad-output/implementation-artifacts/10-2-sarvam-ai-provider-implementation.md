# Story 10.2: Sarvam AI Provider Implementation

Status: done

## Story

As a **developer**,
I want a Sarvam AI adapter for STT and TTS,
So that Indian languages and Hinglish are supported with native code-switching.

## Acceptance Criteria

1. `SarvamProvider` implements `VoiceProvider` interface from story 10-1
2. STT calls Sarvam Saarika v2.5 API (`POST https://api.sarvam.ai/speech-to-text`)
3. TTS calls Sarvam Bulbul v3 API (`POST https://api.sarvam.ai/text-to-speech`)
4. `supportedLanguages` includes: hi, mr, bn, ta, te, gu, kn, ml, pa, or, en, hinglish
5. API key is stored in environment config (`SARVAM_API_KEY`)
6. Error responses from Sarvam API are mapped to standard NestJS exceptions
7. Latency is tracked per request (start→end timing)
8. Unit tests mock Sarvam API responses for STT and TTS
9. Language codes are mapped from internal format (ISO 639-1: `hi`) to Sarvam format (BCP-47: `hi-IN`)

## Tasks / Subtasks

- [x] Task 1: Create SarvamProvider class (AC: #1, #4)
  - [x] 1.1 Create `apps/api/src/modules/voice/providers/sarvam.provider.ts`
  - [x] 1.2 Implement `VoiceProvider` interface — `name`, `supportedLanguages`, `transcribe()`, `synthesize()`, `detectLanguage()`
  - [x] 1.3 Create internal language code mapping: `hi` → `hi-IN`, `mr` → `mr-IN`, `hinglish` → `unknown` (auto-detect)
  - [x] 1.4 Make it `@Injectable()` for NestJS DI

- [x] Task 2: Implement STT — `transcribe()` (AC: #2, #7, #9)
  - [x] 2.1 Build `FormData` with audio buffer, model (`saarika:v2.5`), and language code
  - [x] 2.2 Send `POST` to `https://api.sarvam.ai/speech-to-text` with `api-subscription-key` header
  - [x] 2.3 Parse response: extract `transcript`, `language_code`, `language_probability`
  - [x] 2.4 Map Sarvam language code back to internal format (`hi-IN` → `hi`)
  - [x] 2.5 Track latency with `Date.now()` before/after call
  - [x] 2.6 Return `STTResponse` with text, detectedLanguage, confidence, latencyMs, provider

- [x] Task 3: Implement TTS — `synthesize()` (AC: #3, #7, #9)
  - [x] 3.1 Build JSON body with text, `target_language_code` (BCP-47), speaker, model (`bulbul:v3`), pace
  - [x] 3.2 Send `POST` to `https://api.sarvam.ai/text-to-speech` with `api-subscription-key` header
  - [x] 3.3 Parse response: decode base64 audio from `audios[0]` using `Buffer.from(audios[0], 'base64')`
  - [x] 3.4 Track latency
  - [x] 3.5 Return `TTSResponse` with audio buffer, format, durationMs, latencyMs, provider

- [x] Task 4: Implement `detectLanguage()` (AC: #1)
  - [x] 4.1 Use STT with `language_code: 'unknown'` to auto-detect
  - [x] 4.2 Return detected language and confidence from STT response

- [x] Task 5: Error handling (AC: #6)
  - [x] 5.1 Map Sarvam error codes to NestJS exceptions:
    - `invalid_api_key_error` / `authentication_error` → `UnauthorizedException`
    - `rate_limit_exceeded_error` → `TooManyRequestsException` (429)
    - `invalid_request_error` / `unprocessable_entity_error` → `BadRequestException`
    - `internal_server_error` → `BadGatewayException`
  - [x] 5.2 Handle network timeouts (10s) with `AbortSignal.timeout(10_000)`
  - [x] 5.3 Log errors with provider name and request context

- [x] Task 6: Register provider in VoiceModule (AC: #1)
  - [x] 6.1 Add `SarvamProvider` to VoiceModule providers array
  - [x] 6.2 Register in VoiceService provider registry under key `'sarvam'`

- [x] Task 7: Add environment config (AC: #5)
  - [x] 7.1 Add `SARVAM_API_KEY` to `.env.example`
  - [x] 7.2 Validate API key is present on provider initialization (log warning if missing, don't crash)

- [x] Task 8: Unit tests (AC: #8)
  - [x] 8.1 Create `apps/api/test/services/voice/sarvam.provider.spec.ts`
  - [x] 8.2 Mock `fetch` calls — test successful STT response parsing
  - [x] 8.3 Mock `fetch` calls — test successful TTS response parsing (base64 decode)
  - [x] 8.4 Test language code mapping (internal ↔ BCP-47)
  - [x] 8.5 Test error mapping (each Sarvam error code → correct NestJS exception)
  - [x] 8.6 Test timeout handling
  - [x] 8.7 Test `detectLanguage()` delegates to STT with `unknown` language

## Dev Notes

### Sarvam AI API Reference

**Base URL:** `https://api.sarvam.ai`
**Auth:** `api-subscription-key: <SARVAM_API_KEY>` header on every request
**No official Node.js SDK** — use `fetch` directly (matches existing codebase pattern in `chat.service.ts`)

#### STT Endpoint

```
POST https://api.sarvam.ai/speech-to-text
Content-Type: multipart/form-data
api-subscription-key: <key>
```

**Form fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | binary | Yes | Audio file (WAV, MP3, WebM, OGG, FLAC, etc.) |
| `model` | string | No | Use `saarika:v2.5` (default, best for most cases) |
| `language_code` | string | No | BCP-47: `hi-IN`, `mr-IN`, `en-IN`, `unknown` (auto-detect) |

**Response:**
```typescript
interface SarvamSTTResponse {
  request_id: string | null;
  transcript: string;
  language_code: string | null;       // e.g. 'hi-IN'
  language_probability: number | null; // 0-1
  timestamps: {
    words: string[];
    start_time_seconds: number[];
    end_time_seconds: number[];
  } | null;
}
```

**Supported audio formats (input):** WAV, MP3, AAC, OGG, OPUS, FLAC, WebM, MP4/M4A — browser's `audio/webm` works directly.

**Limitation:** REST API handles audio under ~30 seconds. For longer files, Batch API would be needed (out of scope for this story).

#### TTS Endpoint

```
POST https://api.sarvam.ai/text-to-speech
Content-Type: application/json
api-subscription-key: <key>
```

**Request body:**
```typescript
interface SarvamTTSRequest {
  text: string;                    // Required. Max 2500 chars
  target_language_code: string;    // Required. BCP-47: 'hi-IN', 'mr-IN', 'en-IN'
  model?: string;                  // 'bulbul:v3' (recommended)
  speaker?: string;                // e.g. 'Anushka', 'Abhilash', 'Manisha'
  pace?: number;                   // 0.5-2.0 (maps from ttsSpeed in voiceConfig)
  temperature?: number;            // 0.01-2.0, default 0.6
  speech_sample_rate?: string;     // '22050' is good default
  output_audio_codec?: string;     // 'mp3' (good default for web playback)
}
```

**Response:**
```typescript
interface SarvamTTSResponse {
  request_id: string;
  audios: string[];  // Base64-encoded audio — DECODE with Buffer.from(audios[0], 'base64')
}
```

**CRITICAL:** Sarvam returns base64-encoded audio in a JSON array. You MUST decode it: `Buffer.from(response.audios[0], 'base64')`. This is different from ElevenLabs (raw binary stream) and Deepgram (no Indian TTS).

**Available voices (selection):**
- Female: Anushka, Manisha, Vidya, Arya, Priya, Neha, Kavya, Shreya
- Male: Abhilash, Karun, Hitesh, Aditya, Rahul, Rohan, Dev

#### Error Response Format

```typescript
interface SarvamErrorResponse {
  error: {
    request_id: string | null;
    message: string;
    code: 'invalid_request_error' | 'internal_server_error' | 'unprocessable_entity_error'
      | 'insufficient_quota_error' | 'invalid_api_key_error' | 'authentication_error'
      | 'rate_limit_exceeded_error' | 'not_found_error';
  };
}
```

**HTTP status codes:** 400, 403, 422, 429, 500, 503

### Language Code Mapping

Internal format uses ISO 639-1 (`hi`, `mr`, `en`). Sarvam uses BCP-47 (`hi-IN`, `mr-IN`, `en-IN`).

```typescript
private readonly LANGUAGE_MAP: Record<string, string> = {
  'hi': 'hi-IN',
  'mr': 'mr-IN',
  'bn': 'bn-IN',
  'ta': 'ta-IN',
  'te': 'te-IN',
  'gu': 'gu-IN',
  'kn': 'kn-IN',
  'ml': 'ml-IN',
  'pa': 'pa-IN',
  'or': 'od-IN',    // NOTE: Sarvam uses 'od-IN' not 'or-IN'
  'en': 'en-IN',
  'hinglish': 'unknown',  // Auto-detect handles Hinglish natively
};

private readonly REVERSE_LANGUAGE_MAP: Record<string, string> = {
  'hi-IN': 'hi',
  'mr-IN': 'mr',
  'bn-IN': 'bn',
  'ta-IN': 'ta',
  'te-IN': 'te',
  'gu-IN': 'gu',
  'kn-IN': 'kn',
  'ml-IN': 'ml',
  'pa-IN': 'pa',
  'od-IN': 'or',
  'en-IN': 'en',
};
```

**GOTCHA:** Sarvam uses `od-IN` for Odia, not `or-IN`. The reverse map must account for this.

### Implementation Pattern

Follow the existing `fetch` pattern from `apps/api/src/services/chat.service.ts`:

```typescript
const response = await fetch(url, {
  method: 'POST',
  headers: { 'api-subscription-key': this.apiKey, ...headers },
  body: body,
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) {
  const error = await response.json();
  throw this.mapSarvamError(error);
}
```

For STT (multipart), use Node.js built-in `FormData`:
```typescript
const formData = new FormData();
formData.append('file', new Blob([request.audio]), 'audio.webm');
formData.append('model', 'saarika:v2.5');
formData.append('language_code', this.toSarvamLanguage(request.language));
```

### Pricing Context

- STT: ~₹30/hour of audio
- TTS: ~₹15/10K characters
- Free tier: ₹1,000 credits on signup

### What NOT to Do

- **Do NOT** implement routing logic — that's story 10-5 (VoiceService routing)
- **Do NOT** add database schema changes — that's story 10-6
- **Do NOT** implement the controller endpoints — that's story 10-7
- **Do NOT** handle provider fallbacks — that's story 10-5
- **Do NOT** use any third-party SDK for Sarvam — there is none. Use `fetch` directly.
- **Do NOT** implement streaming STT — REST API only for now

### Dependencies

- **Requires story 10-1** (VoiceProvider interface) to be completed first
- Uses the `VoiceProvider` interface, `STTRequest`, `STTResponse`, `TTSRequest`, `TTSResponse` types from 10-1

### Project Structure Notes

- Provider file: `apps/api/src/modules/voice/providers/sarvam.provider.ts`
- Test file: `apps/api/test/services/voice/sarvam.provider.spec.ts`
- Env var: `SARVAM_API_KEY` in `.env.example`

### References

- [Architecture: Section 20.3 - Provider Implementations](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: Section 20.9 - Voice Provider Comparison](_bmad-output/planning-artifacts/architecture.md)
- [Sarvam AI STT API Docs](https://docs.sarvam.ai/api-reference-docs/endpoints/speech-to-text)
- [Sarvam AI TTS API Docs](https://docs.sarvam.ai/api-reference-docs/endpoints/text-to-speech)
- [Story 10-1: Voice Provider Interface](_bmad-output/implementation-artifacts/10-1-voice-provider-interface-adapter-foundation.md)
- [Existing fetch pattern](apps/api/src/services/chat.service.ts) — `callN8nWebhook` method

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- All 24 unit tests pass (sarvam.provider.spec.ts)
- All 18 existing voice.service tests pass (zero regressions)

### Completion Notes List
- Expanded `SupportedLanguage` type to include all Indian languages (bn, ta, te, gu, kn, ml, pa, or)
- Implemented SarvamProvider with full STT (Saarika v2.5) and TTS (Bulbul v3) support
- Language code mapping between ISO 639-1 (internal) ↔ BCP-47 (Sarvam), including od-IN gotcha for Odia
- Error handling maps all 7 Sarvam error codes to appropriate NestJS HTTP exceptions
- Network timeout handling (10s) with AbortSignal
- detectLanguage delegates to STT with `language_code: 'unknown'`
- Registered in VoiceModule, added SARVAM_API_KEY to .env.example

### File List
- `apps/api/src/modules/voice/providers/sarvam.provider.ts` (new)
- `apps/api/src/modules/voice/providers/voice-provider.interface.ts` (modified — expanded SupportedLanguage)
- `apps/api/src/modules/voice/voice.module.ts` (modified — added SarvamProvider)
- `apps/api/.env.example` (modified — added SARVAM_API_KEY)
- `apps/api/test/services/voice/sarvam.provider.spec.ts` (new — 24 tests)
