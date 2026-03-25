# Story 5-20: Voice Message Integration

Status: ready-for-dev

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
- [ ] Create VoiceRecorder component (AC: #1, #6)
  - [ ] Create `apps/widget/src/components/VoiceRecorder.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [ ] Mic button in ChatInput area (replaces send button when input is empty, or sits alongside it)
  - [ ] Toggle recording mode: tap to start, tap to stop
  - [ ] Use `navigator.mediaDevices.getUserMedia({ audio: true })` for mic access
  - [ ] Use `MediaRecorder` API to capture audio as WebM/Opus (smaller files, good browser support)
  - [ ] Visual feedback during recording: red dot indicator + elapsed duration timer (mm:ss)
  - [ ] Cancel recording button (X icon) to discard without sending
  - [ ] Auto-stop recording at 60 seconds maximum, then auto-send
  - [ ] Discard recordings shorter than 0.5 seconds with tooltip "Hold longer to record"
- [ ] Implement voice message send flow (AC: #1, #2, #7)
  - [ ] User records audio → create Blob from MediaRecorder
  - [ ] POST to `/public/voice/conversation` with multipart form data + `Accept: application/x-ndjson`
  - [ ] On `transcription` chunk: show user message bubble with transcribed text
  - [ ] On each `audio` chunk: progressively append sentence text to bot message (see Progressive Text Display below)
  - [ ] On `end` chunk: finalize bot message, reset state
  - [ ] Backend processes: STT → n8n AI → TTS → streams NDJSON chunks
- [ ] Implement progressive text display in sync with audio (AC: #3, #4)
  - [ ] On first `audio` chunk arrival: create empty bot message bubble, start appending sentence text
  - [ ] On subsequent `audio` chunks: append sentence text to existing bot message (space-separated)
  - [ ] Audio enqueued for playback simultaneously via AudioPlaybackQueue
  - [ ] Result: text appears sentence-by-sentence as the voice reads each sentence
  - [ ] Pattern: same as `onResponseTextChunk` callback already implemented in demo page `use-voice.ts`
- [ ] Create voice client service (AC: #1, #2)
  - [ ] Create `apps/widget/src/services/voice-client.ts`
  - [ ] `sendVoiceMessage(agentId, audioBlob, sessionId?, languageHint?)` method
  - [ ] Build `FormData` with `audio` blob, `agentId`, optional `sessionId` and `languageHint`
  - [ ] POST to `/public/voice/conversation` with `Accept: application/x-ndjson`
  - [ ] Parse NDJSON chunks: `transcription`, `audio`, `end`, `error` types
  - [ ] Timeout: 60 seconds (voice processing involves STT + AI + TTS)
  - [ ] Handle legacy JSON fallback if backend returns `application/json`
- [ ] Implement audio playback queue (AC: #4)
  - [ ] Port `AudioPlaybackQueue` pattern from `apps/web/hooks/use-voice.ts`
  - [ ] Sequential playback of base64 audio chunks as they arrive
  - [ ] Decode base64 → Blob → `URL.createObjectURL()` → `new Audio()` → play
  - [ ] Track object URLs in `Set`, revoke on cleanup
  - [ ] Auto-advance: when one chunk finishes, play next in queue
- [ ] Implement microphone permission handling (AC: #5)
  - [ ] Check `navigator.permissions.query({ name: 'microphone' })` if available
  - [ ] Permission states: `granted` (show mic), `prompt` (show mic, browser asks), `denied` (hide mic)
  - [ ] If `navigator.mediaDevices` undefined (HTTP, old browser): hide mic button
  - [ ] Show tooltip "Microphone access required" on denied
- [ ] Implement voice-specific error handling (AC: #5, #8)
  - [ ] Mic not available: hide voice button, text-only mode
  - [ ] Recording too short (<0.5s): discard, show tooltip
  - [ ] Recording too long (>60s): auto-stop and send
  - [ ] Network error: show error in chat
  - [ ] TTS failure: backend sends text in `response.text` — display as text bubble fallback (AC #8)
  - [ ] Map backend error codes to user-friendly messages
- [ ] Add voice configuration support (AC: #5, #7)
  - [ ] `config.voiceEnabled`: show/hide mic button (default: based on agent voice config)
  - [ ] `config.voiceLanguage`: default language hint for STT
  - [ ] `config.voiceAutoPlay`: auto-play bot audio (default: true)

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
