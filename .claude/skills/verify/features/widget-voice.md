# Widget voice

A visitor records a voice message in the widget. The API transcribes it (STT), the agent answers, and the reply plays back as audio (TTS) with the text shown. Latency for each stage is stored per message.

## Sub-features

- `voice-record`: `Start recording` swaps the input for a recording bar with `Cancel recording`, a timer and `Send voice message`.
- `voice-send`: uploads the clip as multipart to `POST /public/voice/conversation` and streams NDJSON back.
- `voice-reply`: the transcript appears as the visitor's message, then the agent's reply as text and audio. The mic button reads `Stop playback` while audio plays.
- `voice-metrics`: `chat_message_metrics` stores STT, LLM, TTS, time to first audio and total latency.
- `voice-errors`: an `alert` with `Dismiss voice error` for mic denial, no speech, rate limit and provider timeouts.

## How to get to it (user POV)

- Open the widget for a voice-enabled agent and press the mic button in the input bar. Speak, then press `Send voice message`.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Use the `voice` agent.
- A speech clip at `.verify/fixtures/voice.wav` (16 kHz, 16-bit, mono). On Windows, make one with PowerShell `System.Speech.Synthesis.SpeechSynthesizer` and `SetOutputToWaveFile`, for example the phrase "Hello. What are your opening hours?". After adding or changing it, run `browser close` then `browser open`, because Chrome reads the file at launch. The CLI plays it once (`%noloop`).
- If the agent's voice was just switched on in the editor, the next widget load shows the mic. No cache clearing is needed.

- **Open.** Run `cw-verify widget open --agent voice --page visitor`. The dialog is "Verify Voice Bot chat" and `button "Start recording"` is present.
- **Record.** Run `browser click --page visitor --role button --name "Start recording"`, then `browser wait --page visitor --role button --name "Send voice message"`.
- **Send.** Wait a little longer than the clip (about 5 s for a 4 s clip), then click `Send voice message`.
- **Reply.** Run `widget wait-message --page visitor --from agent --new --timeout 45000`. Then `widget messages` shows the transcript as a `visitor` message (for example "Hello. What are your opening hours?") followed by the `agent` reply.
- **Network.** `browser events --type response --since <ISO before send>` shows `POST .../public/voice/conversation?agentId=<publicId>` returning 201.
- **Metrics.** Run `db query "select mm.\"sttLatencyMs\", mm.\"llmLatencyMs\", mm.\"ttsLatencyMs\", mm.\"timeToFirstAudioMs\", mm.\"voiceTotalLatencyMs\" from chat_message_metrics mm join chat_messages cm on cm.id = mm.\"messageId\" join chat_sessions cs on cs.id = cm.\"chatSessionId\" where cs.\"agentId\" = '<agents.voice.id>' order by mm.\"createdAt\" desc limit 1"`. All five are filled. For reference, one run on 2026-09-27 measured STT 1734, LLM 845, TTS 454 and first audio 3094 ms.
- **Proof.** Save a screenshot and an ARIA snapshot under `.verify/artifacts/widget-voice/`, plus the metrics row.

## Gotchas

- A missing mic right after turning voice on is a regression of F-07 (fixed 2026-09-27). Check that `GET .../config` returned 200, not 304, and that the payload has `agent.voiceEnabled: true`. Before the fix, the browser HTTP cache kept the old config.
- Consent mode hides the whole input bar, mic included, until the visitor accepts. Check for `region "Privacy notice"` first.
- Without the fixture, Chrome's fake device sends a beep and the API answers "no speech detected".
- Real STT and TTS providers are called (Sarvam by default). Each run costs a few seconds of audio.
- Headless Chrome may not play audio aloud. Prove the reply by text, the 201 response and the metrics row, not by sound.
- Voice rate limits use the agent UUID, not the publicId used for text chat.
