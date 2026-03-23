# Story 13.7: Streaming Voice Pipeline — Progressive TTS

Status: ready-for-dev

## Story

As a **website visitor using voice chat**,
I want to hear the AI response start playing within seconds,
So that voice conversations feel fast and natural instead of waiting 9+ seconds.

## Acceptance Criteria

1. For agents with voice enabled, the voice controller uses the streaming pipeline via the agent's webhookUrl
2. Tokens from n8n are buffered into sentences using `SentenceBuffer`
3. Each complete sentence triggers a TTS synthesis call immediately
4. Audio chunks are returned progressively to the frontend as chunked JSON response
5. The first audio chunk arrives within ~4 seconds (STT ~2s + AI first sentence ~1-2s + TTS ~0.5s)
6. Subsequent sentences are synthesized and queued while earlier audio plays
7. The final chunk includes `type: "end"` with `fullText` and `totalSentences`
8. Voice analytics metrics capture per-sentence TTS latency and overall streaming metrics
9. Unit tests cover the streaming TTS orchestrator

## Tasks / Subtasks

- [ ] Task 1: Define VoiceStreamChunk interface (AC: 4, 7)
  - [ ] Create `apps/api/src/modules/voice/interfaces/voice-stream.interface.ts`
  - [ ] Define `VoiceAudioChunk { type: 'audio', sentenceIndex, text, audio, audioFormat, audioDurationMs, ttsLatencyMs }`
  - [ ] Define `VoiceEndChunk { type: 'end', fullText, totalSentences }`
  - [ ] Export `VoiceStreamChunk = VoiceAudioChunk | VoiceEndChunk`

- [ ] Task 2: Implement `streamingTTS()` on VoiceService (AC: 1, 2, 3, 6)
  - [ ] Add `async *streamingTTS(tokenStream, language, agentId): AsyncGenerator<VoiceStreamChunk>` to `voice.service.ts`
  - [ ] Create `SentenceBuffer` instance
  - [ ] Iterate token stream, feed tokens to buffer
  - [ ] For each complete sentence: call TTS provider, yield `VoiceAudioChunk`
  - [ ] After stream ends: flush buffer, synthesize remaining text, yield final audio + `VoiceEndChunk`
  - [ ] Track `sentenceIndex` and `fullText` throughout

- [ ] Task 3: Update VoiceController for streaming (AC: 1, 4, 5)
  - [ ] In `voiceConversation()` method, after STT: get webhookUrl via `agentsService.getEffectiveWebhookUrl()`
  - [ ] Call `n8nStreamingService.streamFromWebhookUrl()` → pipe to `voiceService.streamingTTS()`
  - [ ] Set response headers: `Content-Type: application/json`, `Transfer-Encoding: chunked`
  - [ ] Write each `VoiceStreamChunk` as JSON + newline

- [ ] Task 4: Streaming voice analytics (AC: 8)
  - [ ] Log per-sentence TTS latency via existing voice analytics/metrics
  - [ ] Include in response metadata: `totalSentences`, `averageTtsLatencyMs`
  - [ ] Store in voice conversation record alongside existing metrics (sttLatencyMs, aiLatencyMs, etc.)

- [ ] Task 5: Unit tests (AC: 9)
  - [ ] Create `apps/api/test/services/voice/voice-streaming.spec.ts`
  - [ ] Test `streamingTTS()`: mock token stream with 2 sentences → yields 2 audio chunks + end chunk
  - [ ] Test `streamingTTS()`: single sentence stream → 1 audio + end
  - [ ] Test `streamingTTS()`: buffer flush on stream end → remaining text synthesized
  - [ ] Test controller: webhookUrl → streaming path works end-to-end
  - [ ] Update `apps/api/test/controllers/voice/voice.controller.spec.ts`

## Dev Notes

### Current Voice Controller Flow (Sequential)

`voice.controller.ts` `voiceConversation()` currently:
1. Validate audio file + rate limit
2. STT → transcribe audio to text
3. `chatService.sendMessage()` → full n8n webhook round-trip → text response
4. TTS → synthesize full response to audio
5. Return JSON with transcription + response + audio + metrics

**All 5 steps are sequential.** Total ~9s.

### New Streaming Flow

1. Validate audio + rate limit (unchanged)
2. STT → transcribe audio to text (unchanged — still batched HTTP)
3. Get webhookUrl via `agentsService.getEffectiveWebhookUrl()`
4. `n8nStreamingService.streamFromWebhookUrl(webhookUrl, sttResult.text, sessionId)` → AsyncGenerator
5. `voiceService.streamingTTS(tokenStream, language, agentId)` → AsyncGenerator of audio chunks
6. Write chunks to response as they arrive

### streamingTTS Implementation

```typescript
// apps/api/src/modules/voice/voice.service.ts
async *streamingTTS(
  tokenStream: AsyncGenerator<N8nStreamChunk>,
  language: string,
  agentId: string,
): AsyncGenerator<VoiceStreamChunk> {
  const sentenceBuffer = new SentenceBuffer();
  const config = await this.getVoiceConfig(agentId);
  const provider = this.resolveTTSProvider(config, language);
  let sentenceIndex = 0;
  let fullText = '';

  for await (const chunk of tokenStream) {
    if (chunk.type === 'item' && chunk.content) {
      fullText += chunk.content;
      const sentences = sentenceBuffer.addToken(chunk.content);

      for (const sentence of sentences) {
        const ttsResult = await provider.synthesize({
          text: sentence,
          language,
          agentId,
          voiceId: config.ttsVoiceId,
          speed: config.ttsSpeed,
        });

        yield {
          type: 'audio',
          sentenceIndex: sentenceIndex++,
          text: sentence,
          audio: ttsResult.audio.toString('base64'),
          audioFormat: ttsResult.format,
          audioDurationMs: ttsResult.durationMs,
          ttsLatencyMs: ttsResult.latencyMs,
        };
      }
    }
  }

  // Flush remaining buffer
  const remaining = sentenceBuffer.flush();
  if (remaining) {
    const ttsResult = await provider.synthesize({
      text: remaining, language, agentId,
      voiceId: config.ttsVoiceId, speed: config.ttsSpeed,
    });
    yield {
      type: 'audio', sentenceIndex: sentenceIndex++,
      text: remaining, audio: ttsResult.audio.toString('base64'),
      audioFormat: ttsResult.format, audioDurationMs: ttsResult.durationMs,
      ttsLatencyMs: ttsResult.latencyMs,
    };
  }

  yield { type: 'end', fullText, totalSentences: sentenceIndex };
}
```

### Controller Response Format (Streaming Voice)

Chunked JSON — one JSON object per line (NOT SSE, since voice is not consumed by EventSource):
```
{"type":"audio","sentenceIndex":0,"text":"Hello, how can I help you today?","audio":"base64...","audioFormat":"mp3","audioDurationMs":2100,"ttsLatencyMs":340}\n
{"type":"audio","sentenceIndex":1,"text":"I'm here to answer your questions.","audio":"base64...","audioFormat":"mp3","audioDurationMs":1800,"ttsLatencyMs":290}\n
{"type":"end","fullText":"Hello, how can I help you today? I'm here to answer your questions.","totalSentences":2}\n
```

Frontend reads line-by-line, decodes audio, queues for playback.

### Legacy Response Format (Unchanged)

Existing sequential response is a single JSON object:
```json
{
  "transcription": { "text": "...", "language": "hi", "confidence": 0.95 },
  "response": { "text": "...", "audio": "base64...", "audioFormat": "mp3" },
  "metrics": { "sttLatencyMs": 1800, "aiLatencyMs": 4200, "ttsLatencyMs": 2900, "totalLatencyMs": 8900 }
}
```

### Voice Config & Provider Resolution

`VoiceService` already has:
- `getVoiceConfig(agentId)` — cached config lookup (60s TTL)
- `resolveTTSProvider(config, language)` — routes to Sarvam (Indian) or ElevenLabs (English)
- TTS fallback chain: primary → sarvam → elevenlabs

The `streamingTTS()` method reuses all of these. Each sentence goes through the same provider resolution and fallback chain.

### Getting webhookUrl in Voice Controller

Voice controller currently uses `chatService.sendMessage()` for the AI response. For streaming, it needs:
1. `agentsService.getEffectiveWebhookUrl(agentId)` — already exists
2. `n8nStreamingService.streamFromWebhookUrl(url, text, sessionId)` — from Story 13-3

Inject `N8nStreamingService` into VoiceController (or VoiceService).

### Chat Message Storage for Voice Streaming

The current voice flow calls `chatService.sendMessage()` which handles message storage internally. For streaming voice, we skip `sendMessage()` and directly call `streamFromChatTrigger()`. So we need to handle message storage:

- Save user message (text from STT) before streaming starts
- Save assistant message (full text from stream) after stream ends
- Use same `ChatSession` resolution as current flow

Reuse `chatService.resolveAgent()` and `resolveOrCreateSession()` (made public in Story 13-4).

### Dependencies

- **Story 13-3**: `N8nStreamingService.streamFromWebhookUrl()`
- **Story 13-6**: `SentenceBuffer` class
- **Story 13-4**: Public `resolveAgent()` / `resolveOrCreateSession()` on ChatService

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/api/src/modules/voice/interfaces/voice-stream.interface.ts` | CREATE — VoiceStreamChunk types |
| `apps/api/src/modules/voice/voice.service.ts` | MODIFY — add `streamingTTS()` AsyncGenerator |
| `apps/api/src/modules/voice/voice.controller.ts` | MODIFY — add streaming branch, inject new dependencies |
| `apps/api/src/modules/voice/voice.module.ts` | MODIFY — import N8nStreamingService if needed |
| `apps/api/test/services/voice/voice-streaming.spec.ts` | CREATE — streaming TTS tests |
| `apps/api/test/controllers/voice/voice.controller.spec.ts` | MODIFY — add streaming branch tests |

### References

- [Source: architecture.md#Section 20.1.2] — Streaming voice flow diagram
- [Source: architecture.md#Section 20.14.3] — Streaming voice controller spec
- [Source: architecture.md#Section 20.15.2] — streamingTTS orchestrator spec
- [Source: architecture.md#Section 20.15.3] — VoiceStreamChunk interface definition
- [Source: voice.controller.ts] — Current sequential voice flow
- [Source: voice.service.ts] — Provider resolution, config cache, TTS fallback chain

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
