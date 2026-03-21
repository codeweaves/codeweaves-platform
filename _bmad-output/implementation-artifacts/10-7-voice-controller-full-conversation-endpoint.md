# Story 10.7: Voice Controller — Full Conversation Endpoint

Status: review

## Story

As a **developer**,
I want a `/voice/conversation` endpoint that handles the complete voice flow,
So that the widget can send audio and receive audio in one request.

## Acceptance Criteria

1. `POST /voice/conversation` accepts multipart form data (audio file + metadata JSON fields)
2. STT transcribes audio to text using the routed provider (via VoiceService)
3. Transcribed text is sent through the existing chat flow (`ChatService.sendMessage`)
4. AI response text is synthesized to audio via TTS (using the routed provider)
5. Response includes: `transcription` (text, detectedLanguage, confidence), `response` (text, base64 audio, format, durationMs), `metrics` (sttLatencyMs, aiLatencyMs, ttsLatencyMs, totalLatencyMs)
6. Transcribed user message appears in conversation history (same as typed messages)
7. Endpoint respects agent's `voiceConfig` — if TTS disabled, skip synthesis and return text-only response
8. `POST /voice/transcribe` — STT-only endpoint (audio in → text out)
9. `POST /voice/synthesize` — TTS-only endpoint (text in → base64 audio out)
10. `GET /voice/providers` — returns available providers and their supported languages
11. Zod validation schemas for all DTOs in `packages/validation`
12. Rate limiting applied via existing `MessageRateLimitService`
13. All endpoints are public (widget-facing, no JWT required)
14. Unit tests cover the full conversation flow, individual endpoints, error cases, and TTS-disabled scenario

## Tasks / Subtasks

- [x] Task 1: Create Zod validation schemas for voice DTOs (AC: #11)
  - [x] 1.1 Add voice conversation DTO schema in `packages/validation/src/voice.ts`
  - [x] 1.2 Add transcribe-only DTO schema
  - [x] 1.3 Add synthesize DTO schema
  - [x] 1.4 Export all schemas and inferred types from `packages/validation/src/index.ts`

- [x] Task 2: Create VoiceController with conversation endpoint (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] 2.1 Create `apps/api/src/modules/voice/voice.controller.ts`
  - [x] 2.2 Mark controller with `@Public()` decorator (widget-facing, no JWT)
  - [x] 2.3 Implement `POST /voice/conversation` with `@UseInterceptors(FileInterceptor('audio'))`
  - [x] 2.4 Implement the three-step orchestration flow (STT → Chat → TTS)
  - [x] 2.5 When `voiceConfig.ttsEnabled === false`, skip Step 3 and return `response.audio: null`
  - [x] 2.6 Build response shape with transcription, response, sessionId, messageId, metrics
  - [x] 2.7 Track `aiLatencyMs` by timing the `chatService.sendMessage()` call

- [x] Task 3: Add transcribe-only endpoint (AC: #8)
  - [x] 3.1 Implement `POST /voice/transcribe` with `FileInterceptor('audio')`
  - [x] 3.2 Accept `audio` file + body fields (`agentId`, `languageHint`)
  - [x] 3.3 Validate body with `ZodValidationPipe(transcribeSchema)`
  - [x] 3.4 Return STT result: `{ text, detectedLanguage, confidence, latencyMs }`

- [x] Task 4: Add synthesize-only endpoint (AC: #9)
  - [x] 4.1 Implement `POST /voice/synthesize` (JSON body, no file upload)
  - [x] 4.2 Validate body with `ZodValidationPipe(synthesizeSchema)`
  - [x] 4.3 Return TTS result: `{ audio: base64, format, durationMs, latencyMs }`

- [x] Task 5: Add providers info endpoint (AC: #10)
  - [x] 5.1 Implement `GET /voice/providers`
  - [x] 5.2 Return provider list with capabilities (name, stt, tts, languages)
  - [x] 5.3 Read from VoiceService.getProvidersInfo() (not hardcoded in controller)

- [x] Task 6: Rate limiting integration (AC: #12)
  - [x] 6.1 Apply rate limiting on `POST /voice/conversation` using `MessageRateLimitService`
  - [x] 6.2 Extract device identifier from request (same pattern as `PublicChatController`)
  - [x] 6.3 On rate limit exceeded, return `{ error: true, message, retryAfterSeconds }`
  - [x] 6.4 Apply rate limiting on `/voice/transcribe` and `/voice/synthesize` as well

- [x] Task 7: File upload validation and error handling (AC: #1)
  - [x] 7.1 Validate uploaded file exists — return 400 if no audio file provided
  - [x] 7.2 Validate file MIME type is audio (`audio/webm`, `audio/wav`, `audio/mp3`, `audio/mpeg`, `audio/ogg`)
  - [x] 7.3 Validate file size (max 10MB) using `@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))`
  - [x] 7.4 Audio format passed as mimetype directly to VoiceService
  - [x] 7.5 Handle provider errors gracefully — UnsupportedLanguageError → 422, timeout → 504, provider error → 502

- [x] Task 8: Update VoiceModule wiring (AC: #13)
  - [x] 8.1 Import `ChatModule` in `VoiceModule` to access `ChatService`
  - [x] 8.2 NestJS platform-express FileInterceptor available via @nestjs/platform-express (already in deps)
  - [x] 8.3 `VoiceController` already registered in module's `controllers` array
  - [x] 8.4 `MessageRateLimitService` provided directly in VoiceModule (RateLimiterService available globally via RedisModule)

- [x] Task 9: Unit tests (AC: #14)
  - [x] 9.1 Tests at `apps/api/test/controllers/voice/voice.controller.spec.ts`
  - [x] 9.2 Test full conversation flow: audio → STT → chat → TTS → response with all fields
  - [x] 9.3 Test conversation with TTS disabled: should skip synthesis, return `audio: null`
  - [x] 9.4 Test transcribe-only endpoint returns STT result
  - [x] 9.5 Test synthesize-only endpoint returns TTS result
  - [x] 9.6 Test providers endpoint returns provider list
  - [x] 9.7 Test rate limiting blocks excessive requests (3 endpoints)
  - [x] 9.8 Test missing audio file returns 400
  - [x] 9.9 Test invalid MIME type returns 400
  - [x] 9.10 Test provider error (UnsupportedLanguageError) returns 422
  - [x] 9.11 Test provider timeout returns 504
  - [x] 9.12 Test metrics are correctly calculated (stt + ai + tts latencies)

## Dev Notes

### Controller Pattern

Follow the existing `PublicChatController` pattern closely. Key similarities:
- Public endpoints (widget-facing, no JWT)
- Rate limiting via `MessageRateLimitService`
- DTOs validated via `ZodValidationPipe`
- Error handling via NestJS exceptions

### File Upload with NestJS

NestJS uses Multer under the hood. The `FileInterceptor` from `@nestjs/platform-express` handles multipart parsing:

```typescript
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile, UseInterceptors } from '@nestjs/common';

@Post('conversation')
@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
async voiceConversation(
  @UploadedFile() audioFile: Express.Multer.File,
  @Body(new ZodValidationPipe(voiceConversationSchema)) dto: VoiceConversationDto,
) {
  if (!audioFile) {
    throw new BadRequestException('Audio file is required');
  }
  // audioFile.buffer contains the raw audio bytes
  // audioFile.mimetype contains the MIME type
}
```

### Conversation Flow Implementation

```typescript
async voiceConversation(audioFile, dto) {
  const startTime = Date.now();

  // Step 1: STT
  const sttStart = Date.now();
  const sttResult = await this.voiceService.transcribe({
    audio: audioFile.buffer,
    format: this.extractAudioFormat(audioFile.mimetype),
    language: dto.languageHint,
    agentId: dto.agentId,
  });
  const sttLatencyMs = Date.now() - sttStart;

  // Step 2: Chat (reuse existing text-based chat flow)
  const aiStart = Date.now();
  const chatResult = await this.chatService.sendMessage({
    agentId: dto.agentId,
    chatInput: sttResult.text,
    sessionId: dto.sessionId,
  });
  const aiLatencyMs = Date.now() - aiStart;

  // Step 3: TTS (skip if disabled)
  let ttsResult = null;
  let ttsLatencyMs = 0;
  const voiceConfig = await this.voiceService.getVoiceConfig(dto.agentId);

  if (voiceConfig.ttsEnabled !== false) {
    const ttsStart = Date.now();
    ttsResult = await this.voiceService.synthesize({
      text: chatResult.reply,
      language: sttResult.detectedLanguage,
      agentId: dto.agentId,
    });
    ttsLatencyMs = Date.now() - ttsStart;
  }

  return {
    transcription: {
      text: sttResult.text,
      detectedLanguage: sttResult.detectedLanguage,
      confidence: sttResult.confidence,
    },
    response: {
      text: chatResult.reply,
      audio: ttsResult ? ttsResult.audio.toString('base64') : null,
      audioFormat: ttsResult?.format ?? null,
      audioDurationMs: ttsResult?.durationMs ?? null,
    },
    sessionId: chatResult.sessionId,
    messageId: chatResult.messageId,
    metrics: {
      sttLatencyMs,
      aiLatencyMs,
      ttsLatencyMs,
      totalLatencyMs: Date.now() - startTime,
    },
  };
}
```

### Audio Format Extraction

```typescript
private extractAudioFormat(mimetype: string): 'webm' | 'wav' | 'mp3' | 'ogg' {
  const format = mimetype.split('/')[1];
  if (format === 'mpeg') return 'mp3';
  return format as 'webm' | 'wav' | 'mp3' | 'ogg';
}
```

### ChatService Integration

The voice controller reuses `ChatService.sendMessage()` for the AI interaction step. This is critical — voice messages go through the exact same n8n webhook flow as typed messages. The transcribed text is passed as `chatInput`:

```typescript
// This is the SAME call a typed message makes
const chatResult = await this.chatService.sendMessage({
  agentId: dto.agentId,
  chatInput: sttResult.text,  // transcribed text from STT
  sessionId: dto.sessionId,
});
```

This means:
- Voice messages appear in conversation history alongside typed messages
- Session continuity is maintained — user can switch between voice and text mid-conversation
- HMAC verification, n8n webhook calls, message storage all happen identically
- Latency metadata from n8n is captured in the stored message

### VoiceConfig TTS Check

The controller needs to check `voiceConfig.ttsEnabled` before attempting synthesis. The `getVoiceConfig()` method on VoiceService (from story 10-5) returns the parsed config:

```typescript
// VoiceService exposes this (from story 10-5)
async getVoiceConfig(agentId: string): Promise<VoiceConfig>
```

If `ttsEnabled` is `false`, skip the TTS step entirely and return `audio: null` in the response. The widget handles this by displaying text-only.

### Error Handling Strategy

Map voice-specific errors to HTTP status codes:

| Error | HTTP Status | When |
|-------|------------|------|
| No audio file | 400 Bad Request | Missing `audio` field in multipart |
| Invalid MIME type | 400 Bad Request | Non-audio file uploaded |
| File too large | 400 Bad Request | > 10MB audio file (Multer default) |
| Agent not found | 404 Not Found | Invalid `agentId` (handled by ChatService) |
| `UnsupportedLanguageError` | 422 Unprocessable Entity | No provider supports the language |
| Provider timeout | 504 Gateway Timeout | STT/TTS provider timed out |
| Provider error | 502 Bad Gateway | STT/TTS provider returned error |
| Rate limited | 200 OK with `{ error: true, message, retryAfterSeconds }` | Excessive voice requests (matches PublicChatController pattern) |

### What NOT to Do

- **Do NOT** implement WebSocket/streaming for voice — n8n doesn't support it, response is always full
- **Do NOT** store audio files — only the transcribed text is stored in chat history
- **Do NOT** implement voice-specific session management — reuse existing `ChatSession` via `ChatService`
- **Do NOT** add authentication/JWT — these are public widget endpoints (same as `PublicChatController`)
- **Do NOT** implement the widget UI — that's stories 10-8 and 10-9
- **Do NOT** implement language detection as a separate step — the STT provider returns `detectedLanguage`
- **Do NOT** add Swagger decorators beyond basic `@ApiTags` — keep it minimal like existing controllers

### Dependencies

- **Requires stories 10-1 through 10-6** (VoiceProvider interface, all three providers, VoiceService routing, voice config schema)
- Uses `VoiceService.transcribe()` and `VoiceService.synthesize()` from 10-5
- Uses `VoiceService.getVoiceConfig()` from 10-5
- Uses `ChatService.sendMessage()` from Epic 6
- Uses `MessageRateLimitService` from story 11-3
- Uses `ZodValidationPipe` from existing codebase

### Project Structure Notes

- Controller: `apps/api/src/modules/voice/voice.controller.ts` (new)
- Module: `apps/api/src/modules/voice/voice.module.ts` (update from 10-1)
- Validation: `packages/validation/src/voice.ts` (add DTOs, extend from 10-1/10-6)
- Tests: `apps/api/test/services/voice/voice.controller.spec.ts` (new)

### References

- [Architecture: Section 20.5 - Voice Controller](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: Section 20.8 - API Endpoints](_bmad-output/planning-artifacts/architecture.md)
- [Existing PublicChatController](apps/api/src/controllers/public/public-chat.controller.ts) — pattern reference
- [Existing ChatService](apps/api/src/services/chat.service.ts) — `sendMessage()` integration
- [Story 10-5: VoiceService](_bmad-output/implementation-artifacts/10-5-voice-service-language-based-provider-routing.md) — `transcribe()`, `synthesize()`, `getVoiceConfig()`
- [Story 10-6: Voice Config Schema](_bmad-output/implementation-artifacts/10-6-voice-configuration-schema-database.md) — `voiceConfig.ttsEnabled` check

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- All 25 controller unit tests pass
- Full test suite: 59 suites, 1160 tests pass
- Lint, check-types, build all clean

### Completion Notes List
- Task 1: Validation schemas already existed from stories 10-2/10-6 — `voiceConversationSchema`, `transcribeSchema`, `synthesizeSchema` in `packages/validation/src/voice.ts`
- Tasks 2-7: Rewrote `VoiceController` with full conversation endpoint (STT → Chat → TTS), transcribe-only, synthesize-only, and providers info endpoints. Added file upload via `FileInterceptor`, rate limiting via `MessageRateLimitService`, and error mapping (UnsupportedLanguageError → 422, timeout → 504, provider error → 502).
- Task 8: Updated `VoiceModule` to import `ChatModule` for `ChatService` access and provide `MessageRateLimitService` directly.
- Task 9: Rewrote `voice.controller.spec.ts` with 25 tests covering all endpoints, TTS-disabled flow, rate limiting, file validation, and error handling.
- Made `VoiceService.getVoiceConfig()` public (was private) so controller can check `ttsEnabled`.
- Added `VoiceService.getProvidersInfo()` to return detailed provider capabilities dynamically (not hardcoded).

### File List
- `apps/api/src/modules/voice/voice.controller.ts` — rewritten with all endpoints
- `apps/api/src/modules/voice/voice.module.ts` — updated with ChatModule import, MessageRateLimitService
- `apps/api/src/modules/voice/voice.service.ts` — getVoiceConfig made public, added getProvidersInfo()
- `apps/api/test/controllers/voice/voice.controller.spec.ts` — rewritten with 25 comprehensive tests

### Change Log
- 2026-03-21: Implemented story 10-7 — full voice controller with conversation, transcribe, synthesize, and providers endpoints
