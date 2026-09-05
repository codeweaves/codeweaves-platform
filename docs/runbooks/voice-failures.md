# Voice failures

## Symptom
Widget voice shows "Speech recognition failed", "We could not make that out", "Voice stream timeout", or plays no audio. Sentry has events with context `voice`, `operation: stt | tts`.

## Confirm
```sql
SELECT "eventName", provider, "errorMessage", count(*)
FROM event_logs
WHERE channel = 'VOICE' AND success = false AND "createdAt" > now() - interval '1 hour'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```
Names: `VOICE_STT_FAILED`, `VOICE_TTS_SENTENCE_FAILED`, `TTS_ALL_PROVIDERS_FAILED`, `VOICE_STREAM_FAILED` (reason `client_disconnected` vs `empty_reply`), `VOICE_CONVERSATION_EXCEPTION`.

## Cause and fix by pattern
| Pattern | Cause | Fix |
|---|---|---|
| `VOICE_STT_FAILED`, provider sarvam or deepgram, 401/403 | Key revoked or plan lapsed | Rotate `SARVAM_API_KEY` / `DEEPGRAM_API_KEY`, redeploy. STT falls through Sarvam, Deepgram, ElevenLabs before giving up. |
| `VOICE_TTS_SENTENCE_FAILED` from elevenlabs with 401 on the server but fine locally | ElevenLabs free tier blocks datacenter IPs (Render) | Paid ElevenLabs key, or set the agent `ttsProvider` to sarvam |
| `TTS_ALL_PROVIDERS_FAILED` | Sarvam and ElevenLabs both failed for that language | Check both status pages. Language unsupported by both: set the agent `defaultLanguage` |
| "Voice stream timeout", reason `first-chunk` | No audio within 45 s: LLM slow and TTS slow, or a provider WebSocket hanging then falling back | See llm-provider-outage.md; check Sarvam WS. Watchdogs: 45 s first chunk, 25 s idle, 180 s total |
| Many `VOICE_STREAM_FAILED` with `client_disconnected` | Visitors closing the tab mid-reply, or the widget idle timeout firing | Not a server fault unless latency is also up. Compare `timeToFirstChunkMs` in `chat_messages.metadata` |
| Sarvam 429 | Concurrency cap hit (`SARVAM_MAX_CONCURRENT`, default 3) | Raise only if the Sarvam plan allows more parallel synthesis |
| 400 `INVALID_AUDIO` | MIME not in allowlist (webm, wav, mp3, mpeg, ogg, mp4, aac) or over 10 MB | Browser sent an unexpected container; check the widget MediaRecorder mimeType |

## Latency baseline
Query before changing any timeout:
```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (metadata->>'totalLatencyMs')::int) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'totalLatencyMs')::int) AS p95
FROM chat_messages
WHERE metadata->>'inputType' = 'voice' AND role = 'ASSISTANT'
  AND "createdAt" > now() - interval '7 days';
```

## Prevent
- Keep one paid TTS provider that works from server IPs.
- English traffic with no `languageHint` runs STT twice (Sarvam detect, then Deepgram). If the page language is known, pass the hint from the widget to halve STT cost and latency.
