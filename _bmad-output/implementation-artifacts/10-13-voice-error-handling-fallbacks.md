# Story 10.13: Voice Error Handling & Fallbacks

Status: ready-for-dev

## Story

As a **website visitor**,
I want clear feedback when voice operations fail,
So that I can still use the chatbot via text.

## Acceptance Criteria

1. STT failure → user-friendly message: "Couldn't understand audio. Please try again or type your message."
2. TTS failure → response text still shows in chat (graceful degradation), message: "Voice playback unavailable"
3. Microphone permission denied → message with instructions to enable in browser settings
4. Unsupported browser → mic button hidden, no error shown
5. Network error during voice API call → message: "Connection issue. Please try again."
6. Provider timeout (>10s for STT, >15s for TTS) → cancel request, show timeout message
7. All voice errors reported to Sentry with: provider name, language, error type, agentId
8. Text input is ALWAYS available as fallback — voice errors never block text chat
9. Voice UI transitions back to `idle` state on any error (no stuck states)
10. Backend voice errors return structured error responses with `errorCode` for frontend mapping
11. TTS fallback chain (from story 10-5) exhausted → return text-only response, not a 500 error
12. Rate limit exceeded on voice endpoint → message: "Too many voice requests. Please wait."

## Tasks / Subtasks

- [ ] Task 1: Define voice error codes and types (AC: #10)
  - [ ] 1.1 Create error code enum in `packages/validation/src/voice.ts`:
    ```typescript
    export const voiceErrorCodes = {
      STT_FAILED: 'STT_FAILED',
      TTS_FAILED: 'TTS_FAILED',
      UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
      PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
      PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
      INVALID_AUDIO: 'INVALID_AUDIO',
      AUDIO_TOO_SHORT: 'AUDIO_TOO_SHORT',
      RATE_LIMITED: 'RATE_LIMITED',
    } as const;
    ```
  - [ ] 1.2 Export from `packages/validation/src/index.ts`

- [ ] Task 2: Backend error handling in VoiceController (AC: #6, #10, #11)
  - [ ] 2.1 Update `apps/api/src/modules/voice/voice.controller.ts`
  - [ ] 2.2 Wrap STT call in try/catch — on failure, return structured error:
    ```typescript
    { error: true, errorCode: 'STT_FAILED', message: 'Speech recognition failed' }
    ```
  - [ ] 2.3 Wrap TTS call in try/catch — on failure, still return the text response with `audio: null`:
    ```typescript
    {
      transcription: { text, detectedLanguage, confidence },
      response: { text: aiReply, audio: null, audioFormat: null, audioDurationMs: null },
      metrics: { sttLatencyMs, aiLatencyMs, ttsLatencyMs: 0, totalLatencyMs },
      ttsError: { errorCode: 'TTS_FAILED', message: 'Voice synthesis unavailable' },
    }
    ```
  - [ ] 2.4 Handle `UnsupportedLanguageError` from provider routing — return 422 with `UNSUPPORTED_LANGUAGE` code
  - [ ] 2.5 Handle provider timeout — return 504 with `PROVIDER_TIMEOUT` code
  - [ ] 2.6 When TTS fallback chain is exhausted (all providers failed), return text-only response (not 500):
    - This is graceful degradation, not an error — the user still gets the AI's text response
    - Include `ttsError` field so the frontend knows TTS failed

- [ ] Task 3: Sentry error reporting for voice failures (AC: #7)
  - [ ] 3.1 Update voice controller and service error handling to capture Sentry context
  - [ ] 3.2 On STT failure, report to Sentry with extras: `{ provider, language, agentId, errorType: 'stt_failure' }`
  - [ ] 3.3 On TTS failure (including fallback exhaustion), report to Sentry with extras: `{ provider, language, agentId, errorType: 'tts_failure', fallbackAttempted: true }`
  - [ ] 3.4 On provider timeout, report to Sentry with extras: `{ provider, language, agentId, errorType: 'provider_timeout', timeoutMs }`
  - [ ] 3.5 Use existing `SentryService` integration — errors with status >= 500 are already auto-captured by `AllExceptionsFilter`, but voice-specific context needs to be added via `Sentry.setContext()` or `Sentry.captureException()` with extras
  - [ ] 3.6 TTS graceful degradation (text-only fallback) should be logged as a **warning**, not an error — it's expected behavior

- [ ] Task 4: Frontend error handling in useVoice hook (AC: #1, #2, #3, #4, #5, #8, #9)
  - [ ] 4.1 Update `apps/web/hooks/use-voice.ts`
  - [ ] 4.2 Map backend `errorCode` to user-friendly messages:
    ```typescript
    const ERROR_MESSAGES: Record<string, string> = {
      STT_FAILED: "Couldn't understand audio. Please try again or type your message.",
      TTS_FAILED: "Voice playback unavailable",
      UNSUPPORTED_LANGUAGE: "This language is not supported for voice",
      PROVIDER_TIMEOUT: "Voice processing timed out. Please try again.",
      PROVIDER_UNAVAILABLE: "Voice service temporarily unavailable",
      INVALID_AUDIO: "Audio recording was not valid. Please try again.",
      AUDIO_TOO_SHORT: "Recording was too short. Please speak longer.",
      RATE_LIMITED: "Too many voice requests. Please wait a moment.",
    };
    ```
  - [ ] 4.3 Network error handling: `fetch` throws → map to "Connection issue. Please try again."
  - [ ] 4.4 Microphone permission denied: `NotAllowedError` → "Microphone access denied. Please allow microphone in your browser settings."
  - [ ] 4.5 On ANY error, always transition back to `idle` state — no stuck states
  - [ ] 4.6 On TTS failure with text response available: show the text in chat (graceful degradation), show brief error banner for audio failure
  - [ ] 4.7 Text input must remain functional regardless of voice state — if voice errors out, user can immediately type
  - [ ] 4.8 Frontend timeout: if API call takes > 30s, abort with `AbortController` and show timeout message

- [ ] Task 5: Update VoiceErrorBanner for error types (AC: #1, #2, #3, #5, #6, #12)
  - [ ] 5.1 Update `apps/web/components/features/chat/voice-error-banner.tsx` (from story 10-8)
  - [ ] 5.2 Accept `errorCode` prop and display appropriate user-friendly message
  - [ ] 5.3 Different severity levels:
    - **Error** (red): STT failed, network error, timeout, permission denied
    - **Warning** (yellow): TTS failed (text still available), rate limited
    - **Info** (blue): unsupported browser (shown once, dismissible)
  - [ ] 5.4 Auto-dismiss after 5 seconds for warnings, 8 seconds for errors
  - [ ] 5.5 Dismiss on click

- [ ] Task 6: Frontend Sentry reporting (AC: #7)
  - [ ] 6.1 On voice errors in the `useVoice` hook, call `Sentry.captureException()` or `Sentry.captureMessage()` with context
  - [ ] 6.2 Include: `agentId`, `errorCode`, `voiceState` at time of error, browser info (`MediaRecorder` support)
  - [ ] 6.3 Permission denied is NOT an error to report to Sentry (user choice, not a bug)
  - [ ] 6.4 Unsupported browser is NOT an error to report to Sentry (expected condition)

- [ ] Task 7: Unit tests (AC: all)
  - [ ] 7.1 Backend tests in `apps/api/test/services/voice/voice.controller.spec.ts`:
    - Test STT failure returns structured error with `STT_FAILED` code
    - Test TTS failure returns text-only response with `ttsError` field (not 500)
    - Test TTS fallback exhaustion returns graceful degradation response
    - Test provider timeout returns 504 with `PROVIDER_TIMEOUT` code
    - Test `UnsupportedLanguageError` returns 422
    - Test Sentry context is set on voice errors

## Dev Notes

### Graceful Degradation Priority

The most important principle: **voice errors should never break the text chat experience**.

```
Priority ladder:
1. Full voice flow works (STT + AI + TTS) → best case
2. STT works, TTS fails → user sees text response, "Voice playback unavailable" banner
3. STT fails → "Couldn't understand audio, try again or type" → user types instead
4. Voice entirely broken → mic button hidden or disabled, text chat 100% functional
```

### Backend Error Response Shapes

**STT failure (conversation endpoint):**
```json
{
  "error": true,
  "errorCode": "STT_FAILED",
  "message": "Speech recognition failed"
}
```
HTTP 422 — the request was received but audio couldn't be processed.

**TTS failure with graceful degradation (conversation endpoint):**
```json
{
  "transcription": { "text": "Hello, how are you?", "detectedLanguage": "en", "confidence": 0.95 },
  "response": { "text": "I'm doing well! How can I help?", "audio": null, "audioFormat": null, "audioDurationMs": null },
  "sessionId": "...",
  "messageId": "...",
  "metrics": { "sttLatencyMs": 450, "aiLatencyMs": 2100, "ttsLatencyMs": 0, "totalLatencyMs": 2550 },
  "ttsError": { "errorCode": "TTS_FAILED", "message": "Voice synthesis unavailable" }
}
```
HTTP 200 — the request succeeded (user got their answer), TTS just couldn't produce audio.

**Provider timeout:**
```json
{
  "error": true,
  "errorCode": "PROVIDER_TIMEOUT",
  "message": "Voice processing timed out"
}
```
HTTP 504.

### Frontend Error Flow

```typescript
// In useVoice hook
const sendToApi = async (audioBlob: Blob) => {
  setVoiceState('processing');

  try {
    const result = await sendVoiceConversation({ audio: audioBlob, agentId, sessionId });

    // Always deliver the text response if available
    if (result.transcription) {
      onTranscription?.(result.transcription.text, result.transcription.detectedLanguage);
    }
    if (result.response?.text) {
      onResponse?.(result.response.text, result.sessionId);
    }

    // Handle TTS result
    if (result.response?.audio) {
      playAudio(result.response.audio, result.response.audioFormat);
      // voiceState → 'playing'
    } else {
      // TTS failed or disabled — still delivered text
      if (result.ttsError) {
        setError(ERROR_MESSAGES[result.ttsError.errorCode] || 'Voice playback unavailable');
      }
      setVoiceState('idle');
    }
  } catch (err) {
    // Network error, timeout, or server error
    const message = mapErrorToMessage(err);
    setError(message);
    onError?.(message);
    setVoiceState('idle'); // ALWAYS return to idle
  }
};
```

### Sentry Context Pattern

Follow the existing Sentry integration pattern from story 12-1/12-2:

```typescript
// Backend — in voice controller catch blocks
import * as Sentry from '@sentry/node';

Sentry.withScope((scope) => {
  scope.setContext('voice', {
    provider: providerName,
    language: detectedLanguage,
    agentId,
    operation: 'stt' | 'tts',
  });
  scope.setLevel(isTtsFallback ? 'warning' : 'error');
  Sentry.captureException(error);
});
```

```typescript
// Frontend — in useVoice hook
import * as Sentry from '@sentry/nextjs';

Sentry.captureMessage('Voice STT failed', {
  level: 'error',
  extra: { agentId, errorCode, voiceState },
});
```

### What NOT to Do

- **Do NOT** show technical error details to users — always use friendly messages
- **Do NOT** let voice errors put the UI in a stuck state — always return to `idle`
- **Do NOT** block text input during voice errors — text is always the fallback
- **Do NOT** retry voice API calls automatically — let the user decide to try again
- **Do NOT** report permission denied or unsupported browser to Sentry — these are expected conditions
- **Do NOT** return 500 when TTS fallback chain is exhausted — return 200 with text-only response

### Dependencies

- **Requires stories 10-1** (VoiceProviderError, UnsupportedLanguageError types)
- **Requires story 10-5** (VoiceService with TTS fallback chain)
- **Requires story 10-7** (VoiceController endpoints)
- **Requires story 10-8** (useVoice hook, VoiceErrorBanner component)
- Uses existing `AllExceptionsFilter` from the codebase
- Uses existing Sentry integration (stories 12-1, 12-2, 12-15)

### Project Structure Notes

- Error codes: `packages/validation/src/voice.ts` (add to existing)
- Backend controller: `apps/api/src/modules/voice/voice.controller.ts` (modify from 10-7)
- Backend service: `apps/api/src/modules/voice/voice.service.ts` (modify from 10-5)
- Frontend hook: `apps/web/hooks/use-voice.ts` (modify from 10-8)
- Error banner: `apps/web/components/features/chat/voice-error-banner.tsx` (modify from 10-8)
- Backend tests: `apps/api/test/services/voice/voice.controller.spec.ts` (extend from 10-7)

### References

- [Architecture: Section 20.12 - Error Handling & Fallbacks](_bmad-output/planning-artifacts/architecture.md)
- [AllExceptionsFilter](apps/api/src/filters/all-exceptions.filter.ts) — global error handler
- [Story 10-1: Voice Provider Interface](_bmad-output/implementation-artifacts/10-1-voice-provider-interface-adapter-foundation.md) — error types
- [Story 10-5: Voice Service Routing](_bmad-output/implementation-artifacts/10-5-voice-service-language-based-provider-routing.md) — TTS fallback chain
- [Story 10-7: Voice Controller](_bmad-output/implementation-artifacts/10-7-voice-controller-full-conversation-endpoint.md) — endpoint error handling
- [Story 10-8: Voice UI](_bmad-output/implementation-artifacts/10-8-voice-ui-state-machine-mic-button.md) — useVoice hook, error banner
- [Story 12-1: Sentry SDK Integration](_bmad-output/implementation-artifacts/12-1-sentry-sdk-integration.md) — Sentry patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
