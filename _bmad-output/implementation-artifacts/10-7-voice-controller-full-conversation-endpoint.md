# Story 10.7: Voice Controller — Full Conversation Endpoint

Status: ready-for-dev

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

- [ ] Task 1: Create Zod validation schemas for voice DTOs (AC: #11)
  - [ ] 1.1 Add voice conversation DTO schema in `packages/validation/src/voice.ts`:
    ```typescript
    export const voiceConversationSchema = z.object({
      agentId: z.string().uuid(),
      sessionId: z.string().uuid().optional(),
      languageHint: z.string().max(10).optional(),
    });
    ```
  - [ ] 1.2 Add transcribe-only DTO schema:
    ```typescript
    export const voiceTranscribeSchema = z.object({
      agentId: z.string().uuid(),
      languageHint: z.string().max(10).optional(),
    });
    ```
  - [ ] 1.3 Add synthesize DTO schema:
    ```typescript
    export const voiceSynthesizeSchema = z.object({
      agentId: z.string().uuid(),
      text: z.string().min(1).max(5000),
      language: z.string().max(10).default('en'),
      voiceId: z.string().optional(),
    });
    ```
  - [ ] 1.4 Export all schemas and inferred types from `packages/validation/src/index.ts`

- [ ] Task 2: Create VoiceController with conversation endpoint (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] 2.1 Create `apps/api/src/modules/voice/voice.controller.ts`
  - [ ] 2.2 Mark controller with `@Public()` decorator (widget-facing, no JWT)
  - [ ] 2.3 Implement `POST /voice/conversation` with `@UseInterceptors(FileInterceptor('audio'))`:
    - Accept `audio` file (multipart) + body fields (`agentId`, `sessionId`, `languageHint`)
    - Validate file exists and has audio MIME type
    - Validate body with `ZodValidationPipe(voiceConversationSchema)`
  - [ ] 2.4 Implement the three-step orchestration flow:
    ```
    Step 1: STT — voiceService.transcribe({ audio, format, language, agentId })
    Step 2: Chat — chatService.sendMessage({ agentId, chatInput: sttResult.text, sessionId })
    Step 3: TTS — voiceService.synthesize({ text: aiResponse.reply, language: sttResult.detectedLanguage, agentId })
    ```
  - [ ] 2.5 When `voiceConfig.ttsEnabled === false`, skip Step 3 and return `response.audio: null`
  - [ ] 2.6 Build response shape:
    ```typescript
    {
      transcription: { text, detectedLanguage, confidence },
      response: { text, audio: base64 | null, audioFormat, audioDurationMs },
      sessionId,
      messageId,
      metrics: { sttLatencyMs, aiLatencyMs, ttsLatencyMs, totalLatencyMs },
    }
    ```
  - [ ] 2.7 Track `aiLatencyMs` by timing the `chatService.sendMessage()` call

- [ ] Task 3: Add transcribe-only endpoint (AC: #8)
  - [ ] 3.1 Implement `POST /voice/transcribe` with `FileInterceptor('audio')`
  - [ ] 3.2 Accept `audio` file + body fields (`agentId`, `languageHint`)
  - [ ] 3.3 Validate body with `ZodValidationPipe(voiceTranscribeSchema)`
  - [ ] 3.4 Return STT result: `{ text, detectedLanguage, confidence, latencyMs }`

- [ ] Task 4: Add synthesize-only endpoint (AC: #9)
  - [ ] 4.1 Implement `POST /voice/synthesize` (JSON body, no file upload)
  - [ ] 4.2 Validate body with `ZodValidationPipe(voiceSynthesizeSchema)`
  - [ ] 4.3 Return TTS result: `{ audio: base64, format, durationMs, latencyMs }`

- [ ] Task 5: Add providers info endpoint (AC: #10)
  - [ ] 5.1 Implement `GET /voice/providers`
  - [ ] 5.2 Return static list of available providers with capabilities:
    ```typescript
    {
      providers: [
        { name: 'sarvam', stt: true, tts: true, languages: ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish', 'en'] },
        { name: 'deepgram', stt: true, tts: false, languages: ['en'] },
        { name: 'elevenlabs', stt: true, tts: true, languages: ['en', 'hi', 'fr', 'de', 'es', 'ja', 'ko', 'zh'] },
      ]
    }
    ```
  - [ ] 5.3 Read from VoiceService or a static config (avoid hardcoding in controller)

- [ ] Task 6: Rate limiting integration (AC: #12)
  - [ ] 6.1 Apply rate limiting on `POST /voice/conversation` using `MessageRateLimitService`
  - [ ] 6.2 Extract device identifier from request (same pattern as `PublicChatController`)
  - [ ] 6.3 On rate limit exceeded, return `{ error: true, message, retryAfterSeconds }`
  - [ ] 6.4 Apply rate limiting on `/voice/transcribe` and `/voice/synthesize` as well

- [ ] Task 7: File upload validation and error handling (AC: #1)
  - [ ] 7.1 Validate uploaded file exists — return 400 if no audio file provided
  - [ ] 7.2 Validate file MIME type is audio (`audio/webm`, `audio/wav`, `audio/mp3`, `audio/mpeg`, `audio/ogg`)
  - [ ] 7.3 Validate file size (max 10MB) using `@UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))`
  - [ ] 7.4 Extract audio format from MIME type: `audioFile.mimetype.split('/')[1]` (map `mpeg` → `mp3`)
  - [ ] 7.5 Handle provider errors gracefully — catch and map to appropriate HTTP status codes:
    - `UnsupportedLanguageError` → 422 Unprocessable Entity
    - Provider timeout → 504 Gateway Timeout
    - Provider error → 502 Bad Gateway

- [ ] Task 8: Update VoiceModule wiring (AC: #13)
  - [ ] 8.1 Import `ChatModule` in `VoiceModule` to access `ChatService`
  - [ ] 8.2 Import required NestJS platform-express modules for file upload (`MulterModule` if needed)
  - [ ] 8.3 Register `VoiceController` in the module's `controllers` array
  - [ ] 8.4 Ensure `MessageRateLimitService` is available (import from `ChatModule` or provide directly)

- [ ] Task 9: Unit tests (AC: #14)
  - [ ] 9.1 Create `apps/api/test/services/voice/voice.controller.spec.ts`
  - [ ] 9.2 Test full conversation flow: audio → STT → chat → TTS → response with all fields
  - [ ] 9.3 Test conversation with TTS disabled: should skip synthesis, return `audio: null`
  - [ ] 9.4 Test transcribe-only endpoint returns STT result
  - [ ] 9.5 Test synthesize-only endpoint returns TTS result
  - [ ] 9.6 Test providers endpoint returns provider list
  - [ ] 9.7 Test rate limiting blocks excessive requests
  - [ ] 9.8 Test missing audio file returns 400
  - [ ] 9.9 Test invalid MIME type returns 400
  - [ ] 9.10 Test provider error (UnsupportedLanguageError) returns 422
  - [ ] 9.11 Test provider timeout returns 504
  - [ ] 9.12 Test metrics are correctly calculated (stt + ai + tts latencies)

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
| File too large | 413 Payload Too Large | > 10MB audio file |
| Agent not found | 404 Not Found | Invalid `agentId` (handled by ChatService) |
| `UnsupportedLanguageError` | 422 Unprocessable Entity | No provider supports the language |
| Provider timeout | 504 Gateway Timeout | STT/TTS provider timed out |
| Provider error | 502 Bad Gateway | STT/TTS provider returned error |
| Rate limited | 429 Too Many Requests | Excessive voice requests |

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

### Debug Log References

### Completion Notes List

### File List
