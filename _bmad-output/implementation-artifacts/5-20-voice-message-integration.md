# Story 5-20: Voice Message Integration

Status: done

## Story
As a **website visitor**, I want to send voice messages and receive voice replies in the chat widget, with the AI's response text appearing progressively in sync with the audio playback, so that I can follow along with what the AI is saying.

## Voice Response UX
Voice conversations show **text messages in the chat**, NOT audio-only bubbles. When the AI responds:
1. Text appears sentence-by-sentence as each TTS audio chunk arrives (progressive display)
2. Audio plays simultaneously alongside the text
3. The user sees the text being built up in sync with the voice — no lag between hearing and reading

This matches the text SSE streaming UX: text appears progressively, but for voice it's driven by audio chunk arrival rather than SSE token chunks.

**What we do NOT show**: Audio player bubbles, waveform visualizations, or standalone audio controls. Voice is a transport mechanism — the chat UI stays text-based.

## Acceptance Criteria
1. User can record voice via mic button in chat input
2. User's transcribed text appears as a user message bubble
3. AI voice response text appears progressively sentence-by-sentence as audio chunks arrive
4. Audio plays concurrently with text display — no desync
5. Mic permission handled gracefully — text-only fallback if denied
6. Recording has visual feedback (red dot, timer)
7. Voice and text messages coexist in the same conversation
8. If TTS fails, full text response still displays as fallback

## Tasks / Subtasks
- [x] Create VoiceRecorder component (AC: #1, #6)
  - [x] Create `apps/widget/src/components/VoiceRecorder.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [x] Mic button in ChatInput area (replaces send button when input is empty, or sits alongside it)
  - [x] Toggle recording mode: tap to start, tap to stop
  - [x] Use `navigator.mediaDevices.getUserMedia({ audio: true })` for mic access
  - [x] Use `MediaRecorder` API to capture audio as WebM/Opus (smaller files, good browser support)
  - [x] Visual feedback during recording: red dot indicator + elapsed duration timer (mm:ss)
  - [x] Cancel recording button (X icon) to discard without sending
  - [x] Auto-stop recording at 60 seconds maximum, then auto-send
  - [x] Discard recordings shorter than 0.5 seconds with tooltip "Hold longer to record"
  - [x] **Voice button state colors** — each state has distinct icon, color, and optional animation:
    - `idle`: primary color (`--cw-primary`), mic icon
    - `listening`: red (`#ef4444`), stop icon, pulse animation (`animate-ping` / CSS `@keyframes cw-pulse`)
    - `processing`: gray (`#9ca3af`), spinner icon, spin animation (`animate-spin` / CSS `@keyframes cw-spin`), button disabled
    - `playing`: orange (`#f97316`), stop icon (tap to stop playback)
- [x] Implement voice message send flow (AC: #1, #2, #7)
  - [x] User records audio → create Blob from MediaRecorder
  - [x] POST to `/public/voice/conversation` with multipart form data + `Accept: application/x-ndjson`
  - [x] On `transcription` chunk: show user message bubble with transcribed text
  - [x] On each `audio` chunk: progressively append sentence text to bot message (see Progressive Text Display below)
  - [x] On `end` chunk: finalize bot message, reset state
  - [x] Backend processes: STT → n8n AI → TTS → streams NDJSON chunks
- [x] Implement progressive text display in sync with audio (AC: #3, #4)
  - [x] On first `audio` chunk arrival: create empty bot message bubble, start appending sentence text
  - [x] On subsequent `audio` chunks: append sentence text to existing bot message (space-separated)
  - [x] Audio enqueued for playback simultaneously via AudioPlaybackQueue
  - [x] Result: text appears sentence-by-sentence as the voice reads each sentence
  - [x] Pattern: same as `onResponseTextChunk` callback already implemented in demo page `use-voice.ts`
  - [x] **Typewriter buffer pattern**: text chunks feed into a typewriter buffer for char-by-char rendering (~12ms per 2 chars)
    - On first audio chunk: create empty bot message, start a `setInterval` typewriter drainer, feed sentence text to buffer
    - On subsequent audio chunks: append `" " + sentenceText` to buffer (typewriter interval keeps draining chars from buffer into displayed text)
    - On response complete (`end` chunk): flush remaining buffer immediately (clear interval, set full text)
    - Reference implementation: `apps/web/hooks/use-voice.ts` typewriter buffer pattern + `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` `onResponseTextChunk`
- [x] Create voice client service (AC: #1, #2)
  - [x] Create `apps/widget/src/services/voice-client.ts`
  - [x] `sendVoiceMessage(agentId, audioBlob, sessionId?, languageHint?)` method
  - [x] Build `FormData` with `audio` blob, `agentId`, optional `sessionId` and `languageHint`
  - [x] POST to `/public/voice/conversation` with `Accept: application/x-ndjson`
  - [x] Parse NDJSON chunks: `transcription`, `audio`, `end`, `error` types
  - [x] Timeout: 60 seconds (voice processing involves STT + AI + TTS)
  - [x] Handle legacy JSON fallback if backend returns `application/json`
- [x] Implement audio playback queue (AC: #4)
  - [x] Port `AudioPlaybackQueue` pattern from `apps/web/hooks/use-voice.ts`
  - [x] Sequential playback of base64 audio chunks as they arrive
  - [x] Decode base64 → Blob → `URL.createObjectURL()` → `new Audio()` → play
  - [x] Track object URLs in `Set`, revoke on cleanup
  - [x] Auto-advance: when one chunk finishes, play next in queue
  - [x] **`canplaythrough` requirement**: queue must wait for the `canplaythrough` event before calling `audio.play()`
    - This prevents the first word of audio from being cut off (browser needs to buffer enough data first)
    - Pattern: create `new Audio()`, set `audio.oncanplaythrough` handler that calls `audio.play()`, THEN set `audio.src` to the object URL
    - Do NOT use `new Audio(url)` constructor shorthand — it starts loading before the handler is attached
    - Reference fix: `apps/web/hooks/use-voice.ts` `AudioPlaybackQueue.playNext()`
- [x] Implement microphone permission handling (AC: #5)
  - [x] Check `navigator.permissions.query({ name: 'microphone' })` if available
  - [x] Permission states: `granted` (show mic), `prompt` (show mic, browser asks), `denied` (hide mic)
  - [x] If `navigator.mediaDevices` undefined (HTTP, old browser): hide mic button
  - [x] Show tooltip "Microphone access required" on denied
- [x] Implement voice-specific error handling (AC: #5, #8)
  - [x] Mic not available: hide voice button, text-only mode
  - [x] Recording too short (<0.5s): discard, show tooltip
  - [x] Recording too long (>60s): auto-stop and send
  - [x] Network error: show error in chat
  - [x] TTS failure: backend sends text in `response.text` — display as text bubble fallback (AC #8)
  - [x] Map backend error codes to user-friendly messages (same mapping as demo page `ERROR_MESSAGES`)
- [x] Implement voice error banner (AC: #5, #8)
  - [x] Display voice errors in a banner positioned above the input area (not as a chat message)
  - [x] Severity-based styling: `error` = red background, `warning` = yellow background, `info` = blue background
  - [x] Auto-dismiss timers: errors auto-dismiss after 8 seconds, warnings after 5 seconds
  - [x] Dismissible via close (X) button on the banner
  - [x] Map backend error codes to user-friendly messages (reuse same `ERROR_MESSAGES` mapping as demo page)
- [x] Add voice configuration support (AC: #5, #7)
  - [x] `config.voiceEnabled`: show/hide mic button (default: based on agent voice config)
  - [x] `config.voiceLanguage`: default language hint for STT
  - [x] `config.voiceAutoPlay`: auto-play bot audio (default: true)

## Dev Notes

### Progressive Text Display Architecture
The key insight: each NDJSON `audio` chunk contains BOTH the audio AND the sentence text. We use this to display text in sync with audio:

```
Timeline:
  Audio chunk 1 arrives → enqueue audio for play → append "Hello, how are you?" to bot message
  Audio chunk 2 arrives → enqueue audio for play → append "I can help with that." to bot message
  Audio chunk 3 arrives → enqueue audio for play → append "Let me explain." to bot message
  'end' chunk arrives → finalize message

Result: User sees text building up sentence-by-sentence while hearing the same words spoken.
```

This pattern is already proven in the demo page (`apps/web/hooks/use-voice.ts` `onResponseTextChunk` callback + `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx`).

### Voice Endpoint Contract
`POST /public/voice/conversation` — multipart form data:

**Request fields:**
- `audio` (file): WebM/Opus, WAV, MP3, OGG, MP4, AAC (max 10MB)
- `agentId` (string): agent public ID
- `sessionId` (string, optional): session ID for conversation continuity
- `languageHint` (string, optional): language code for STT

**Response (NDJSON streaming, when `Accept: application/x-ndjson`):**
```
{"type":"transcription","text":"...","detectedLanguage":"en","confidence":0.95,"sttLatencyMs":800}
{"type":"audio","sentenceIndex":0,"text":"Hello, how are you?","audio":"<base64>","audioFormat":"audio/mp3","audioDurationMs":1500,"ttsLatencyMs":400}
{"type":"audio","sentenceIndex":1,"text":"I can help with that.","audio":"<base64>","audioFormat":"audio/mp3","audioDurationMs":1800,"ttsLatencyMs":350}
{"type":"end","fullText":"Hello, how are you? I can help with that.","totalSentences":2}
```

### Future Enhancement: Karaoke Highlighting (not in scope)
A future UX improvement: show all text in a lighter shade immediately, then transition each sentence to full color as its audio starts playing. This creates a karaoke/teleprompter effect. Deferred — current implementation is text appearing per-sentence which is good enough.

### Memory Management
- Track all object URLs in a `Set<string>`
- Revoke all URLs via `URL.revokeObjectURL()` on component unmount or session reset
- Clean up MediaStream tracks on recording stop

### Bundle Impact
- MediaRecorder, Audio, and getUserMedia are all native browser APIs — zero external libraries
- Estimated widget bundle impact: ~2-3KB gzipped (component code only)

### References
- Demo page reference implementation: `apps/web/hooks/use-voice.ts` (onResponseTextChunk pattern)
- Demo page UI: `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx`
- Voice controller: `apps/api/src/modules/voice/voice.controller.ts`
- Voice service: `apps/api/src/modules/voice/voice.service.ts`
- Voice stream interface: `apps/api/src/modules/voice/interfaces/voice-stream.interface.ts`
- Allowed audio MIME types: `audio/webm`, `audio/wav`, `audio/mp3`, `audio/mpeg`, `audio/ogg`, `audio/mp4`, `audio/aac`
- Max file size: 10MB

## Dev Agent Record

### Implementation Plan
- Port AudioPlaybackQueue from `apps/web/hooks/use-voice.ts` as standalone utility
- Create voice-client.ts service with NDJSON stream parsing (mirrors web app's voice-api.ts)
- Create useVoice hook (widget-specific port of web app's use-voice.ts)
- Create VoiceRecorder component with 4-state UI (idle/listening/processing/playing)
- Create VoiceErrorBanner component with severity-based styling
- Integrate into ChatInput (mic replaces send when input empty) and ChatWindow (typewriter buffer pattern)
- Wire voice callbacks to useChat's new helper methods for message management

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | High | External abort (non-timeout) left voice state stuck in 'processing' | Always call `setVoiceStateSynced('idle')` on any AbortError, not just timeout |
| P2 | High | Typewriter `setInterval` leaked on ChatWindow unmount | Added cleanup `useEffect` that calls `stopTypewriter()` on unmount |
| P3 | Medium | Cancel recording still sent audio to API via `recorder.onstop` handler | Added `cancelledRef` flag; `cancelRecording()` sets flag before stop; onstop checks flag and discards |
| P4 | Medium | `voiceAutoPlay=false` left state stuck in 'playing' forever | Conditional: only transition to 'playing' when autoPlay is on; go idle immediately in onComplete if no audio or autoPlay off |
| P5 | Low | Double 60s timeout — voice-client.ts had its own AbortController + timeout alongside useVoice's | Removed voice-client's internal timeout/controller; now accepts caller's `signal` directly |
| P6 | Medium | Voice enabled by default when theme has no voice config — mic button shows for non-voice agents | Changed default from `voice?.enabled !== false` to `voice?.enabled === true` |
| P7 | Medium | Unmount cleanup triggered `recorder.stop()` → `onstop` → `handleApiCall` race condition | Added `mountedRef`; detach `onstop` handler before stopping in `cleanupRecording`; guard `handleApiCall` with mounted check |
| D2 | Low | `isSupported` was static — mic button stayed visible after user revokes permission | Made reactive via `navigator.permissions.query` change listener that updates `isSupported` state |

### Debug Log
- All TypeScript types pass cleanly
- Build succeeds with no errors
- Lint passes with zero warnings

### Completion Notes
- Created `voice-client.ts` — NDJSON streaming parser with FormData upload, 60s timeout, legacy JSON fallback
- Created `audio-playback-queue.ts` — sequential base64 audio playback with `canplaythrough` guard
- Created `useVoice.ts` hook — full state machine (idle→listening→processing→playing) with MediaRecorder, auto-stop at 60s, min 0.5s guard
- Created `VoiceRecorder.tsx` — 4-state button with SVG icons, recording info bar (red dot + timer + cancel)
- Created `VoiceErrorBanner.tsx` — severity-based error display (red/yellow/blue) with auto-dismiss
- Updated `ChatInput.tsx` — added `voiceSlot` prop; mic button shows when input is empty and voice is enabled
- Updated `useChat.ts` — added `addUserMessage`, `createBotMessage`, `appendBotMessageText`, `finalizeBotMessage`, `setVoiceLoading` methods for voice integration
- Updated `ChatWindow.tsx` — wired useVoice hook with typewriter buffer pattern for progressive text display synced to audio chunks
- Updated `Widget.tsx` — initialized voice client alongside API client
- Updated `components.ts` — added CSS for voice button states, recording info, pulse/spin animations, error banner with severity variants
- All patterns ported from proven demo page implementation (apps/web/hooks/use-voice.ts)

## File List
- `apps/widget/src/services/voice-client.ts` (new)
- `apps/widget/src/utils/audio-playback-queue.ts` (new)
- `apps/widget/src/hooks/useVoice.ts` (new)
- `apps/widget/src/components/VoiceRecorder.tsx` (new)
- `apps/widget/src/components/VoiceErrorBanner.tsx` (new)
- `apps/widget/src/components/ChatInput.tsx` (modified)
- `apps/widget/src/hooks/useChat.ts` (modified)
- `apps/widget/src/components/ChatWindow.tsx` (modified)
- `apps/widget/src/components/Widget.tsx` (modified)
- `apps/widget/src/styles/components.ts` (modified)

## Senior Developer Review (AI)
- **Review Date**: 2026-03-27
- **Outcome**: PASS (with fixes applied)
- **Reviewers**: 3-layer adversarial review (Security/Correctness, Performance/UX, Architecture/Maintainability)
- **Total Findings**: 16 (7 patches, 2 defers, 7 rejected)
- **Action Items**:
  - [x] P1 (High): Fix external abort leaving voice state stuck in 'processing'
  - [x] P2 (High): Add typewriter interval cleanup on ChatWindow unmount
  - [x] P3 (Medium): Fix cancel recording sending audio instead of discarding
  - [x] P4 (Medium): Fix voiceAutoPlay=false stuck in 'playing' state
  - [x] P5 (Low): Remove double timeout in voice pipeline
  - [x] P6 (Medium): Default voiceConfig.enabled to false when no config
  - [x] P7 (Medium): Prevent unmount cleanup from triggering API call race
  - [x] D2 (Low): Make isSupported reactive to permission revocation
  - [ ] D1 (Low): Deferred — add aria-live region for voice state transitions (accessibility enhancement, not a bug)

## Change Log
- 2026-03-27: Implemented voice message integration — full recording, streaming NDJSON, progressive text display with typewriter buffer, audio playback queue, error handling with severity banners
- 2026-03-27: Fixed 8 code review findings (P1-P7, D2) — state machine edge cases, memory leaks, race conditions, permission reactivity
