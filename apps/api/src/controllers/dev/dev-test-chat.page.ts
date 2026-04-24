/**
 * HTML for the dev test chat page. Inlined as a string (rather than a separate
 * .html file) so it bundles with `nest build` without needing any asset-copy
 * config changes.
 *
 * Served from GET /dev/ai/test-chat. See DevAiController for the endpoint.
 *
 * Design notes:
 *   - Zero external dependencies. No React, no CDNs. Vanilla DOM + fetch.
 *     This is a dev debugging tool — keep it trivial to reason about.
 *   - Uses POST-based SSE (fetch + ReadableStream + TextDecoder) because
 *     EventSource only supports GET. Mirrors the pattern the production
 *     widget uses for /public/chat/stream so we exercise the same wire format.
 *   - Three-pane layout: agents list / chat / trace events. The trace pane is
 *     the point of the whole exercise — it shows exactly what the
 *     orchestration did before any token was produced.
 */
export const devTestChatHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Orchestration Dev Tester</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
    body { display: flex; flex-direction: column; }
    header { padding: 12px 20px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 15px; margin: 0; color: #f1f5f9; font-weight: 600; }
    header .badge { background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; }
    .controls { margin-left: auto; display: flex; gap: 8px; align-items: center; }
    select, button { background: #334155; color: #e2e8f0; border: 1px solid #475569; padding: 6px 10px; border-radius: 4px; font-size: 13px; cursor: pointer; }
    select { min-width: 260px; font-size: 16px; }
    button:hover { background: #475569; }
    button.primary { background: #3b82f6; border-color: #3b82f6; color: white; }
    button.primary:hover { background: #2563eb; }
    button.danger { background: #7f1d1d; border-color: #991b1b; }
    .session-id { font-family: monospace; font-size: 11px; color: #94a3b8; padding: 4px 8px; background: #1e293b; border-radius: 4px; }

    main { flex: 1; display: grid; grid-template-columns: 1fr 420px; gap: 0; overflow: hidden; }
    .chat-pane, .trace-pane { display: flex; flex-direction: column; overflow: hidden; }
    .chat-pane { background: #0f172a; }
    .trace-pane { background: #020617; border-left: 1px solid #334155; }
    .pane-header { padding: 8px 16px; background: #1e293b; border-bottom: 1px solid #334155; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .pane-header .count { color: #64748b; font-weight: 400; text-transform: none; letter-spacing: 0; }

    .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .msg { padding: 10px 14px; border-radius: 8px; max-width: 80%; line-height: 1.5; font-size: 14px; white-space: pre-wrap; word-wrap: break-word; }
    .msg.user { align-self: flex-end; background: #3b82f6; color: white; }
    .msg.assistant { align-self: flex-start; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
    .msg.assistant .cursor { display: inline-block; width: 6px; height: 14px; background: #94a3b8; animation: blink 1s step-end infinite; vertical-align: middle; margin-left: 2px; }
    @keyframes blink { 50% { opacity: 0; } }
    .msg .meta { font-size: 11px; color: #94a3b8; margin-top: 6px; font-family: monospace; }

    .input-area { padding: 12px 16px; border-top: 1px solid #334155; background: #1e293b; display: flex; gap: 8px; align-items: flex-end; }
    .input-area textarea { flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; color: #e2e8f0; font-family: inherit; font-size: 14px; resize: none; min-height: 40px; max-height: 120px; }
    .input-area textarea:focus { outline: none; border-color: #3b82f6; }

    /* Mic button states */
    button.mic { background: #334155; border-color: #475569; color: #e2e8f0; padding: 8px 12px; font-size: 16px; min-width: 44px; }
    button.mic:hover { background: #475569; }
    button.mic.recording { background: #dc2626; border-color: #dc2626; color: white; animation: pulse 1.2s ease-in-out infinite; }
    button.mic.processing { background: #f59e0b; border-color: #f59e0b; color: white; }
    button.mic.playing { background: #10b981; border-color: #10b981; color: white; }
    button.mic:disabled { opacity: 0.5; cursor: not-allowed; animation: none; }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6); } 50% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); } }

    /* Voice status indicator above input */
    .voice-status { padding: 6px 16px 0; font-size: 11px; color: #94a3b8; font-family: monospace; display: none; }
    .voice-status.active { display: block; }
    .voice-status .timer { color: #fbbf24; }

    .trace-events { flex: 1; overflow-y: auto; padding: 8px; font-family: 'Menlo', 'Consolas', monospace; font-size: 12px; }
    .trace-event { background: #1e293b; border: 1px solid #334155; border-radius: 4px; margin-bottom: 6px; padding: 8px 10px; }
    .trace-event .step { color: #60a5fa; font-weight: 600; }
    .trace-event .duration { color: #fbbf24; float: right; }
    .trace-event .data { color: #94a3b8; margin-top: 4px; line-height: 1.5; word-wrap: break-word; }
    .trace-event.lifecycle { background: #082f49; border-color: #0c4a6e; }
    .trace-event.lifecycle .step { color: #38bdf8; }
    .trace-event.error { background: #450a0a; border-color: #7f1d1d; }
    .trace-event.error .step { color: #f87171; }

    .empty { color: #64748b; text-align: center; padding: 40px 20px; font-size: 13px; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
  </style>
</head>
<body>
  <header>
    <h1>🧠 AI Orchestration Dev Tester</h1>
    <span class="badge" id="envBadge">connecting…</span>
    <div class="controls">
      <select id="agentSelect" disabled>
        <option>Loading agents…</option>
      </select>
      <span class="session-id" id="sessionLabel">no session</span>
      <button id="resetBtn" type="button">New Session</button>
    </div>
  </header>

  <main>
    <section class="chat-pane">
      <div class="pane-header">
        <span>Chat</span>
        <span class="count" id="messageCount"></span>
      </div>
      <div class="messages" id="messages">
        <div class="empty">Pick an agent and send a message.</div>
      </div>
      <div class="voice-status" id="voiceStatus"></div>
      <div class="input-area">
        <textarea id="input" rows="1" placeholder="Type a message and press Enter…"></textarea>
        <button class="mic" id="micBtn" type="button" title="Hold to record voice">🎙️</button>
        <button class="primary" id="sendBtn" type="button">Send</button>
      </div>
    </section>

    <aside class="trace-pane">
      <div class="pane-header">
        <span>Trace Events</span>
        <span class="count" id="traceCount"></span>
      </div>
      <div class="trace-events" id="traceEvents">
        <div class="empty">Trace events appear here in real-time as the orchestration runs.</div>
      </div>
    </aside>
  </main>

  <script>
    // State
    let currentSessionId = null;
    let messageCount = 0;
    // In-memory chat history for this session. We send the last N to the server
    // on each turn so it can skip the Supabase history lookup — same pattern
    // ChatGPT / Claude web clients use. Server still persists messages for audit.
    const conversationHistory = [];
    const MAX_HISTORY_TO_SEND = 10;
    let traceCount = 0;
    let streaming = false;

    // Voice state
    let mediaRecorder = null;
    let audioChunks = [];
    let voiceStatus = 'idle'; // 'idle' | 'recording' | 'processing' | 'playing'
    let recordingStartedAt = 0;
    let recordingTimer = null;
    // Audio playback queue — TTS chunks arrive out-of-order-relative-to-UI but
    // must play in sentenceIndex order. We buffer and play sequentially.
    const audioPlaybackQueue = [];
    let isPlayingQueue = false;

    // Elements
    const agentSelect = document.getElementById('agentSelect');
    const sessionLabel = document.getElementById('sessionLabel');
    const resetBtn = document.getElementById('resetBtn');
    const messagesEl = document.getElementById('messages');
    const micBtn = document.getElementById('micBtn');
    const voiceStatusEl = document.getElementById('voiceStatus');
    const traceEventsEl = document.getElementById('traceEvents');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const messageCountEl = document.getElementById('messageCount');
    const traceCountEl = document.getElementById('traceCount');
    const envBadge = document.getElementById('envBadge');

    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Enter to send (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);
    resetBtn.addEventListener('click', resetSession);
    micBtn.addEventListener('click', toggleRecording);

    // Load agent list on startup
    loadAgents();

    // ===================== VOICE =====================

    function setVoiceStatus(state, text) {
      voiceStatus = state;
      micBtn.classList.remove('recording', 'processing', 'playing');
      if (state !== 'idle') {
        micBtn.classList.add(state);
      }
      if (text) {
        voiceStatusEl.textContent = text;
        voiceStatusEl.classList.add('active');
      } else {
        voiceStatusEl.classList.remove('active');
      }
    }

    function stopRecordingTimer() {
      if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
    }

    async function toggleRecording() {
      if (voiceStatus === 'recording') {
        stopRecording();
      } else if (voiceStatus === 'idle') {
        await startRecording();
      }
      // 'processing' and 'playing' states: click does nothing (button disabled-ish)
    }

    async function startRecording() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Microphone access is not supported in this browser.');
        return;
      }
      const agentId = agentSelect.value;
      if (!agentId) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Pick a MIME type the browser supports — webm is universal on Chrome/Edge,
        // mp4 on Safari. The backend accepts both via ALLOWED_AUDIO_MIMES.
        const mimeType = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';
        mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          // Stop all tracks so the browser releases the mic (red dot in tab bar goes away)
          stream.getTracks().forEach((t) => t.stop());
          sendVoiceMessage();
        };
        mediaRecorder.start();
        recordingStartedAt = Date.now();
        setVoiceStatus('recording', 'Recording… 0s');
        recordingTimer = setInterval(() => {
          const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
          voiceStatusEl.innerHTML = \`Recording… <span class="timer">\${seconds}s</span> — click mic again to stop\`;
          // Safety cap: 60 seconds
          if (seconds >= 60) stopRecording();
        }, 200);
      } catch (err) {
        console.error('Mic access failed', err);
        alert('Microphone access denied or unavailable.');
        setVoiceStatus('idle', '');
      }
    }

    function stopRecording() {
      stopRecordingTimer();
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }

    async function sendVoiceMessage() {
      if (audioChunks.length === 0) {
        setVoiceStatus('idle', '');
        return;
      }
      const agentId = agentSelect.value;
      if (!agentId) {
        setVoiceStatus('idle', '');
        return;
      }

      // Reset the scheduled-time clock so the next conversation's first chunk
      // gets the 120ms warmup lookahead again (otherwise it would schedule in
      // the distant future, matching the END of the previous conversation).
      nextScheduledTime = 0;

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      setVoiceStatus('processing', 'Transcribing + generating response…');

      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('agentId', agentId);
      formData.append('source', 'DEMO');
      if (currentSessionId) formData.append('sessionId', currentSessionId);

      try {
        // Voice endpoint lives under the global API prefix (not excluded from
        // prefix like /dev/ai/* is). Accept: application/x-ndjson opts us into
        // the streaming path (transcription + audio chunks + end).
        const res = await fetch('/api/codeweaves/v1/public/voice/conversation', {
          method: 'POST',
          headers: { 'Accept': 'application/x-ndjson' },
          body: formData,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error('Voice request failed: ' + res.status + ' ' + text);
        }

        const contentType = res.headers.get('Content-Type') || '';
        if (!contentType.includes('x-ndjson')) {
          // Server decided to return a single JSON (e.g. TTS disabled or fallback).
          // Handle gracefully: show the transcription + response without streaming.
          const json = await res.json();
          await handleVoiceJsonResponse(json);
          setVoiceStatus('idle', '');
          return;
        }

        // Update session ID from headers if the server created a new one
        const headerSessionId = res.headers.get('X-Session-Id');
        if (headerSessionId) {
          // The header value is the DB id; the actual external sessionId comes
          // in the transcription/done chunks. We use the external one below.
        }

        await readNdjsonVoiceStream(res);
      } catch (err) {
        console.error(err);
        addTraceEvent('voice.error', null, { message: String(err) }, 'error');
        setVoiceStatus('idle', '');
      } finally {
        audioChunks = [];
      }
    }

    async function readNdjsonVoiceStream(res) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Create a placeholder assistant message that we'll append TTS-text to
      // as sentences arrive. Keeps chat pane in sync with audio playback.
      const assistant = addAssistantMessage();
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: one JSON per line
        let idx;
        while ((idx = buffer.indexOf('\\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const chunk = JSON.parse(line);
            handleVoiceChunk(chunk, assistant, (text) => { accumulatedText = text; });
          } catch (err) {
            console.warn('Malformed NDJSON line:', line);
          }
        }
      }
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim());
          handleVoiceChunk(chunk, assistant, (text) => { accumulatedText = text; });
        } catch {}
      }

      // Remove cursor once stream ended (audio may still be playing from queue)
      assistant.cursor.remove();
    }

    function handleVoiceChunk(chunk, assistant, setAccumulated) {
      switch (chunk.type) {
        case 'transcription':
          // Server transcribed user's speech — add as user message
          clearEmpty(messagesEl);
          const userDiv = document.createElement('div');
          userDiv.className = 'msg user';
          userDiv.textContent = chunk.text;
          // Insert BEFORE the placeholder assistant bubble we created earlier
          messagesEl.insertBefore(userDiv, assistant.div);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          messageCount++;
          updateCounts();
          addTraceEvent('stt.transcribe', chunk.sttLatencyMs ?? null, {
            language: chunk.detectedLanguage,
            confidence: chunk.confidence,
            text: chunk.text.slice(0, 120),
          }, 'lifecycle');
          break;

        case 'audio':
          // Append sentence text to the assistant bubble + queue audio for playback
          assistant.textSpan.textContent += (assistant.textSpan.textContent ? ' ' : '') + chunk.text;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          setAccumulated(assistant.textSpan.textContent);
          addTraceEvent(\`tts.synthesize[\${chunk.sentenceIndex}]\`, chunk.ttsLatencyMs ?? null, {
            text: chunk.text.slice(0, 80),
            durationMs: chunk.audioDurationMs,
            format: chunk.audioFormat,
          }, 'lifecycle');
          enqueueAudio(chunk.audio, chunk.audioFormat);
          break;

        case 'end':
          addTraceEvent('voice.end', null, {
            totalSentences: chunk.totalSentences,
            fullTextLength: (chunk.fullText || '').length,
          }, 'lifecycle');
          if (currentSessionId == null && chunk.sessionId) {
            currentSessionId = chunk.sessionId;
            sessionLabel.textContent = currentSessionId.slice(0, 8) + '…';
          }
          break;

        case 'error':
          addTraceEvent('voice.error', null, { errorCode: chunk.errorCode, message: chunk.message }, 'error');
          if (voiceStatus !== 'playing') setVoiceStatus('idle', '');
          break;
      }
    }

    async function handleVoiceJsonResponse(json) {
      // Non-streaming fallback: server returned a single JSON with { transcription, response, sessionId, ... }
      if (json.error) {
        addTraceEvent('voice.error', null, json, 'error');
        return;
      }
      if (json.sessionId) {
        currentSessionId = json.sessionId;
        sessionLabel.textContent = currentSessionId.slice(0, 8) + '…';
      }
      if (json.transcription?.text) {
        clearEmpty(messagesEl);
        const userDiv = document.createElement('div');
        userDiv.className = 'msg user';
        userDiv.textContent = json.transcription.text;
        messagesEl.appendChild(userDiv);
        messageCount++;
      }
      if (json.response?.text) {
        const assistant = addAssistantMessage();
        assistant.textSpan.textContent = json.response.text;
        assistant.cursor.remove();
        if (json.response.audio) {
          enqueueAudio(json.response.audio, json.response.audioFormat || 'audio/mpeg');
        }
      }
      updateCounts();
    }

    // ---------- Audio playback queue (Web Audio API) ----------
    // We use Web Audio API rather than HTMLAudioElement because:
    //   1. HTMLAudioElement + canplaythrough has a race where playback can
    //      start before the decoder is synced, clipping the first ~200ms
    //      (caused the "I'm a de" cut-off on the first response).
    //   2. Web Audio gives us gapless playback between chunks (no silent gap
    //      between sentences like HTMLAudioElement has on re-src).
    //   3. We can track exact scheduling timestamps for accurate debugging.
    //
    // AudioContext must be created on a user gesture (click). We lazy-init it
    // when the mic button is first used — no autoplay-policy surprises.

    let audioCtx = null;
    // Wall-clock time in the audio context when the NEXT chunk should start.
    // We schedule each buffer to start right after the previous one ends for
    // gapless playback.
    let nextScheduledTime = 0;

    function ensureAudioContext() {
      if (!audioCtx) {
        // eslint-disable-next-line no-undef
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }

    /**
     * Scan the decoded buffer for the first non-zero sample across all channels.
     * Returns the duration (seconds) of leading silence to skip on playback.
     *
     * Most MP3 encoders add ~1105 priming samples (24ms @ 44.1kHz) of true
     * zero-value silence. Some TTS providers include extra leading padding.
     * This scan is O(N) in the worst case but short-circuits as soon as any
     * audio is found — typically after <0.05% of the buffer.
     */
    function findLeadingSilence(audioBuffer) {
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }
      const len = channels[0].length;
      for (let i = 0; i < len; i++) {
        for (const data of channels) {
          // Use a tiny threshold instead of exact 0: some encoders emit samples
          // at the absolute noise floor (1e-9 or so) during priming that are
          // technically non-zero but still inaudible.
          if (Math.abs(data[i]) > 1e-4) {
            return i / audioBuffer.sampleRate;
          }
        }
      }
      // Entire buffer is silence — shouldn't happen, but return duration so
      // playback is a no-op rather than replaying silence.
      return audioBuffer.duration;
    }

    function enqueueAudio(base64Audio, mimeType) {
      if (!base64Audio) return;
      audioPlaybackQueue.push({ base64: base64Audio, mimeType });
      if (!isPlayingQueue) playNextInQueue();
    }

    async function playNextInQueue() {
      const next = audioPlaybackQueue.shift();
      if (!next) {
        isPlayingQueue = false;
        if (voiceStatus === 'playing') setVoiceStatus('idle', '');
        return;
      }
      isPlayingQueue = true;
      setVoiceStatus('playing', 'Playing response…');

      try {
        const ctx = ensureAudioContext();
        // Ensure the context is actually running before we schedule anything.
        // resume() returns immediately but hardware may take a tick to come up.
        if (ctx.state !== 'running') {
          await ctx.resume().catch(() => {});
        }
        // base64 → ArrayBuffer
        const bytes = atob(next.base64);
        const buffer = new ArrayBuffer(bytes.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) view[i] = bytes.charCodeAt(i);

        // Decode the compressed audio into a PCM AudioBuffer.
        const audioBuffer = await ctx.decodeAudioData(buffer);

        // FIX: MP3 encoders inject ~1024 "priming samples" (24-45ms of silence)
        // at the start of every file per the MP3 spec. Chrome/Firefox/Edge's
        // decodeAudioData() returns those silent samples in the buffer; Safari
        // removes them automatically. If we play from offset 0, we hear
        // 24-45ms of silence before the real content starts — which on
        // sequential sentences creates a perceived "cut off first word" effect.
        //
        // Detect the leading silence by scanning for the first non-zero sample,
        // then pass that offset to source.start(when, offset) so playback
        // begins at real audio content.
        //
        // Ref: https://jakearchibald.com/2016/sounds-fun/
        const leadingSilence = findLeadingSilence(audioBuffer);

        // Schedule the buffer. On the VERY FIRST chunk of a conversation, we
        // add a small lookahead (250ms per Jake Archibald's recommendation)
        // to give the audio hardware time to prepare. Subsequent chunks chain
        // off nextScheduledTime for gapless playback.
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        const now = ctx.currentTime;
        const FIRST_CHUNK_LOOKAHEAD = 0.25;
        if (nextScheduledTime === 0) {
          nextScheduledTime = now + FIRST_CHUNK_LOOKAHEAD;
        }
        const startAt = Math.max(now, nextScheduledTime);
        // start(when, offset) — offset skips the leading silence within the buffer.
        source.start(startAt, leadingSilence);
        // Duration for scheduling chains off the REAL content length, not the
        // full buffer (which includes the skipped silence).
        nextScheduledTime = startAt + (audioBuffer.duration - leadingSilence);

        // Wait for this buffer to finish before pulling the next one from the
        // queue. Web Audio's onended event fires exactly when playback completes.
        await new Promise((resolve) => {
          source.onended = resolve;
        });
      } catch (err) {
        console.warn('Audio chunk playback failed', err);
      }
      // Continue with next chunk
      playNextInQueue();
    }

    async function loadAgents() {
      try {
        const res = await fetch('/dev/ai/agents');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const agents = await res.json();
        agentSelect.innerHTML = '';
        if (agents.length === 0) {
          agentSelect.innerHTML = '<option disabled>No agents found — run \\'bun run seed:demo-agents\\' first</option>';
          envBadge.textContent = 'no agents';
          envBadge.style.color = '#f87171';
          return;
        }
        for (const a of agents) {
          const opt = document.createElement('option');
          opt.value = a.id;
          const model = a.modelId ? a.modelId.split('/').pop() : 'default';
          opt.textContent = \`\${a.name} — \${a.routingMode}/\${model}\`;
          agentSelect.appendChild(opt);
        }
        agentSelect.disabled = false;
        envBadge.textContent = \`\${agents.length} agent\${agents.length === 1 ? '' : 's'}\`;
        envBadge.style.color = '#10b981';
      } catch (err) {
        envBadge.textContent = 'error loading agents';
        envBadge.style.color = '#f87171';
        console.error('Failed to load agents', err);
      }
    }

    function resetSession() {
      currentSessionId = null;
      messageCount = 0;
      traceCount = 0;
      conversationHistory.length = 0;
      updateCounts();
      sessionLabel.textContent = 'no session';
      messagesEl.innerHTML = '<div class="empty">New session — send a message to begin.</div>';
      traceEventsEl.innerHTML = '<div class="empty">Trace events appear here in real-time as the orchestration runs.</div>';
    }

    function updateCounts() {
      messageCountEl.textContent = messageCount ? \`(\${messageCount} message\${messageCount === 1 ? '' : 's'})\` : '';
      traceCountEl.textContent = traceCount ? \`(\${traceCount} event\${traceCount === 1 ? '' : 's'})\` : '';
    }

    function clearEmpty(el) {
      const empty = el.querySelector('.empty');
      if (empty) empty.remove();
    }

    function addUserMessage(text) {
      clearEmpty(messagesEl);
      const div = document.createElement('div');
      div.className = 'msg user';
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      messageCount++;
      updateCounts();
    }

    function addAssistantMessage() {
      clearEmpty(messagesEl);
      const div = document.createElement('div');
      div.className = 'msg assistant';
      const textSpan = document.createElement('span');
      textSpan.className = 'text';
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      div.appendChild(textSpan);
      div.appendChild(cursor);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      messageCount++;
      updateCounts();
      return { div, textSpan, cursor };
    }

    function setAssistantMeta(div, meta) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';
      metaDiv.textContent = meta;
      div.appendChild(metaDiv);
    }

    function addTraceEvent(step, durationMs, data, variant) {
      clearEmpty(traceEventsEl);
      const div = document.createElement('div');
      div.className = 'trace-event' + (variant ? ' ' + variant : '');
      const stepLabel = \`<span class="step">\${step}</span>\`;
      const durationLabel = durationMs != null ? \`<span class="duration">\${durationMs}ms</span>\` : '';
      div.innerHTML = stepLabel + durationLabel;
      if (data && Object.keys(data).length > 0) {
        const dataDiv = document.createElement('div');
        dataDiv.className = 'data';
        dataDiv.textContent = JSON.stringify(data);
        div.appendChild(dataDiv);
      }
      traceEventsEl.appendChild(div);
      traceEventsEl.scrollTop = traceEventsEl.scrollHeight;
      traceCount++;
      updateCounts();
    }

    async function sendMessage() {
      if (streaming) return;
      const message = input.value.trim();
      if (!message) return;
      const agentId = agentSelect.value;
      if (!agentId) return;

      streaming = true;
      sendBtn.disabled = true;
      input.value = '';
      input.style.height = 'auto';

      addUserMessage(message);
      const assistant = addAssistantMessage();

      // Snapshot history BEFORE pushing the new user message. The server
      // treats message as the current turn; recentHistory is prior turns
      // only. Capped at MAX_HISTORY_TO_SEND to keep the payload bounded even
      // after long sessions (agent maxContextMessages will trim further).
      const historySnapshot = conversationHistory.slice(-MAX_HISTORY_TO_SEND);
      // Now add the new user turn to our own tracking so the NEXT send
      // includes it. Assistant response is appended when the stream finishes.
      conversationHistory.push({ role: 'user', content: message });
      let assistantBuffer = '';

      try {
        const res = await fetch('/dev/ai/test-chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            message,
            sessionId: currentSessionId,
            recentHistory: historySnapshot,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error('Request failed: ' + res.status);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Split on double newline (SSE event delimiter)
          let idx;
          while ((idx = buffer.indexOf('\\n\\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const maybeDelta = handleSseEvent(raw, assistant);
            if (maybeDelta) assistantBuffer += maybeDelta;
          }
        }

        // Handle final buffered event if any
        if (buffer.trim()) {
          const maybeDelta = handleSseEvent(buffer, assistant);
          if (maybeDelta) assistantBuffer += maybeDelta;
        }

        // Push completed assistant turn so next request includes it in history.
        if (assistantBuffer) {
          conversationHistory.push({ role: 'assistant', content: assistantBuffer });
        }
      } catch (err) {
        console.error(err);
        addTraceEvent('client.error', null, { message: String(err) }, 'error');
      } finally {
        assistant.cursor.remove();
        streaming = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }

    function handleSseEvent(raw, assistant) {
      // Parse an SSE event block: "event: X\\ndata: Y"
      const lines = raw.split('\\n');
      let eventName = 'message';
      let dataJson = '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataJson += line.slice(5).trim();
      }
      if (!dataJson) return;

      let data;
      try { data = JSON.parse(dataJson); }
      catch { console.warn('Malformed SSE data', dataJson); return; }

      switch (eventName) {
        case 'session':
          if (data.sessionId && data.sessionId !== currentSessionId) {
            currentSessionId = data.sessionId;
            sessionLabel.textContent = data.sessionId.slice(0, 8) + '…';
          }
          break;
        case 'trace':
          addTraceEvent(data.step, data.durationMs, data.data, 'lifecycle');
          break;
        case 'chunk':
          assistant.textSpan.textContent += data.content;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return data.content; // surface so caller can build assistantBuffer
        case 'done':
          if (data.traceId) {
            setAssistantMeta(assistant.div, \`trace: \${data.traceId} · msg: \${(data.messageId || '').slice(0, 8)}\`);
          }
          break;
        case 'error':
          assistant.textSpan.textContent = '⚠️ ' + (data.message || 'Unknown error');
          addTraceEvent('error', null, data, 'error');
          break;
      }
    }
  </script>
</body>
</html>`;
