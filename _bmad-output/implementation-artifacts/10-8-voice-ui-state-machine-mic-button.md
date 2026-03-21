# Story 10.8: Voice UI — State Machine & Mic Button

Status: done

## Story

As a **user**,
I want a microphone button in the chat interface that lets me speak instead of type,
So that I can interact with the agent using voice on both the demo page and agent editor preview.

## Acceptance Criteria

1. Microphone button appears next to the send button when the agent has `voiceEnabled: true`
2. 4-state machine governs the voice UI: `idle → listening → processing → playing`
3. State-specific UI behaviors:
   - **idle**: mic button visible, text input enabled, send button visible
   - **listening**: stop icon replaces mic, text input DISABLED, pulse animation on mic area, recording duration timer displayed
   - **processing**: spinner/loading indicator, text input DISABLED, "Processing..." label
   - **playing**: audio waveform or speaker icon, stop button to cancel playback, text input DISABLED
4. Mic click in `idle` → browser requests microphone permission → transitions to `listening`
5. Stop click in `listening` → transitions to `processing` → sends audio to `POST /voice/conversation`
6. After response received and audio plays → transitions back to `idle`
7. `useVoice` custom hook encapsulates all state machine logic, MediaRecorder interaction, and API calls
8. Maximum 60-second recording with auto-stop
9. Microphone permission denied shows a clear error message (not a crash)
10. Voice UI works on both the **demo page** (functional — real API calls) and **agent editor preview** (visual-only — shows themed mic button, animations, UI states, but NO real API calls or recording)
11. Voice button respects the agent's theme colors (uses existing CSS variable / theme system)
12. Accessibility: all voice buttons have `aria-label`, state changes announced to screen readers

## Tasks / Subtasks

- [x] Task 1: Create `useVoice` hook (AC: #2, #3, #4, #5, #6, #7, #8, #9)
  - [x] 1.1 Create `apps/web/hooks/use-voice.ts`
  - [x] 1.2 Define state machine type:
    ```typescript
    type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';
    ```
  - [x] 1.3 Implement state transitions:
    ```
    idle → listening     (user clicks mic, permission granted)
    idle → error         (user clicks mic, permission denied)
    listening → processing  (user clicks stop OR 60s auto-stop)
    processing → playing    (API returns audio response)
    processing → idle       (API returns text-only response, ttsEnabled=false)
    playing → idle          (audio playback ends OR user clicks stop)
    error → idle            (after displaying error)
    ```
  - [x] 1.4 Hook signature:
    ```typescript
    interface UseVoiceOptions {
      agentId: string;
      sessionId?: string;
      onTranscription?: (text: string, language: string) => void;
      onResponse?: (reply: string, sessionId: string) => void;
      onError?: (error: string) => void;
    }

    interface UseVoiceReturn {
      voiceState: VoiceState;
      startRecording: () => Promise<void>;
      stopRecording: () => void;
      stopPlayback: () => void;
      recordingDurationMs: number;
      error: string | null;
      isSupported: boolean;  // false if MediaRecorder not available
    }
    ```
  - [x] 1.5 Check `navigator.mediaDevices?.getUserMedia` support on mount — set `isSupported` accordingly
  - [x] 1.6 `startRecording()`: request mic permission → create `MediaRecorder` with `audio/webm` → start recording → transition to `listening`
  - [x] 1.7 Track recording duration with `setInterval` (update every 100ms)
  - [x] 1.8 Auto-stop at 60 seconds: `setTimeout(() => stopRecording(), 60_000)` — clear on manual stop
  - [x] 1.9 `stopRecording()`: stop `MediaRecorder` → collect chunks into `Blob` → transition to `processing` → call API
  - [x] 1.10 API call: `POST /voice/conversation` with `FormData` (audio blob + agentId + sessionId + languageHint)
  - [x] 1.11 On successful response: call `onTranscription` and `onResponse` callbacks → if audio present, transition to `playing` → if no audio, transition to `idle`
  - [x] 1.12 On error: set `error` state, transition to `idle`, call `onError` callback
  - [x] 1.13 Cleanup: stop MediaRecorder, release mic stream, clear timers on unmount

- [x] Task 2: Create VoiceMicButton component (AC: #1, #3, #11, #12)
  - [x] 2.1 Create `apps/web/components/features/chat/voice-mic-button.tsx`
  - [x] 2.2 Render different icons/states based on `voiceState`:
    - `idle`: microphone icon (e.g., `Mic` from lucide-react)
    - `listening`: stop icon (`Square`) with pulse animation
    - `processing`: spinner (`Loader2` with `animate-spin`)
    - `playing`: speaker icon (`Volume2`) with stop option
  - [x] 2.3 Show recording duration timer during `listening` state (format: `0:05`, `0:30`, `1:00`)
  - [x] 2.4 Pulse animation on the mic button during `listening` (CSS `animate-pulse` or custom keyframes with ring effect)
  - [x] 2.5 Button is disabled during `processing` state
  - [x] 2.6 Use theme colors from parent context (demo page theme or editor preview theme)
  - [x] 2.7 Add `aria-label` for each state: "Start recording", "Stop recording", "Processing voice", "Stop playback"
  - [x] 2.8 Add `aria-live="polite"` region for state change announcements

- [x] Task 3: Create VoiceErrorBanner component (AC: #9)
  - [x] 3.1 Create inline error display (not a modal/toast — appears near the mic button)
  - [x] 3.2 Show specific messages:
    - Permission denied: "Microphone access denied. Please allow microphone in your browser settings."
    - Not supported: "Voice is not supported in this browser."
    - API error: "Voice processing failed. Please try again."
    - Rate limited: "Too many voice requests. Please wait."
  - [x] 3.3 Auto-dismiss after 5 seconds or on user click

- [x] Task 4: Integrate voice into demo page (AC: #10)
  - [x] 4.1 Update `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx`
  - [x] 4.2 Fetch `voiceEnabled` from the agent demo endpoint response (may need API update if not included)
  - [x] 4.3 Conditionally render `VoiceMicButton` next to the send button when `voiceEnabled: true`
  - [x] 4.4 Initialize `useVoice` hook with `agentId` and current `sessionId`
  - [x] 4.5 Wire `onTranscription` callback: add user message to chat (same as typed message)
  - [x] 4.6 Wire `onResponse` callback: add assistant message to chat with typewriter animation (same as text response)
  - [x] 4.7 Disable text input and send button during `listening`, `processing`, `playing` states
  - [x] 4.8 Show `VoiceErrorBanner` when voice error occurs

- [x] Task 5: Integrate voice visuals into agent editor preview (AC: #10)
  - [x] 5.1 Update `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx`
  - [x] 5.2 Accept `voiceEnabled` prop (from agent editor form data)
  - [x] 5.3 Conditionally render `VoiceMicButton` next to the send button when `voiceEnabled` is toggled on
  - [x] 5.4 Preview is **visual-only**: show the themed mic button and UI layout but do NOT initialize `useVoice` hook, no real recording, no API calls
  - [x] 5.5 Optionally allow cycling through states via click for visual preview (idle → listening → processing → playing → idle) so the user can see all animation states in the theme editor
  - [x] 5.6 Respect preview theme colors for the voice button

- [x] Task 6: API integration helper (AC: #5, #6)
  - [x] 6.1 Create `apps/web/lib/voice-api.ts` with typed API call:
    ```typescript
    export async function sendVoiceConversation(params: {
      audio: Blob;
      agentId: string;
      sessionId?: string;
      languageHint?: string;
    }): Promise<VoiceConversationResponse> {
      const formData = new FormData();
      formData.append('audio', params.audio, 'recording.webm');
      formData.append('agentId', params.agentId);
      if (params.sessionId) formData.append('sessionId', params.sessionId);
      if (params.languageHint) formData.append('languageHint', params.languageHint);

      const response = await fetch(`${API_URL}/voice/conversation`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new VoiceApiError(response);
      return response.json();
    }
    ```
  - [x] 6.2 Define `VoiceConversationResponse` type matching the API response shape from 10-7
  - [x] 6.3 Handle error responses (rate limit, validation, server errors) with typed error classes

## Dev Notes

### State Machine Diagram

```
                    ┌──────────────────────────┐
                    │                          │
     mic click      │     ┌──────────┐        │ permission
    ─────────────►  │     │  idle    │ ◄──────┘  denied
                    │     └────┬─────┘          (show error)
                    │          │
                    │    permission granted
                    │          │
                    │          ▼
                    │     ┌──────────┐
                    │     │ listening │──── 60s auto-stop ──┐
                    │     └────┬─────┘                      │
                    │          │                             │
                    │     stop click                         │
                    │          │◄────────────────────────────┘
                    │          ▼
                    │     ┌───────────┐
                    │     │processing │
                    │     └─────┬─────┘
                    │      ┌────┴────┐
                    │      │         │
                    │   has audio  no audio
                    │      │      (tts off)
                    │      ▼         │
                    │  ┌────────┐    │
                    │  │playing │    │
                    │  └───┬────┘    │
                    │      │         │
                    │  audio ends    │
                    │  or stop click │
                    │      │         │
                    └──────┴─────────┘
```

### Demo Page Integration Point

The demo page currently has a message input area at the bottom. The mic button goes **next to** the existing send button:

```
┌─────────────────────────────────────────┐
│  [message input field...        ] [🎤][➤]│
└─────────────────────────────────────────┘
```

During `listening` state:
```
┌─────────────────────────────────────────┐
│  [  Recording... 0:05           ] [⏹][  ]│
└─────────────────────────────────────────┘
```

### MediaRecorder Pattern

```typescript
const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      stream.getTracks().forEach(track => track.stop()); // release mic
      sendToApi(blob);
    };

    recorder.start();
    setVoiceState('listening');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      setError('Microphone access denied');
    }
  }
};
```

### Audio Playback

The API returns base64 audio. Play it using the Web Audio API or a simple `<audio>` element:

```typescript
const playAudio = (base64Audio: string, format: string) => {
  const audioBlob = base64ToBlob(base64Audio, `audio/${format}`);
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);

  audio.onended = () => {
    URL.revokeObjectURL(audioUrl);
    setVoiceState('idle');
  };

  audio.play();
  setVoiceState('playing');
};
```

### Chat Integration Callbacks

The `useVoice` hook uses callbacks to integrate with whatever chat UI hosts it:

```typescript
// In demo-page-client.tsx
const { voiceState, startRecording, stopRecording, stopPlayback } = useVoice({
  agentId,
  sessionId: currentSessionId,
  onTranscription: (text, language) => {
    // Add user message to chat (same as if they typed it)
    addMessage({ role: 'user', content: text });
  },
  onResponse: (reply, newSessionId) => {
    // Add assistant message to chat (with typewriter animation)
    addMessage({ role: 'assistant', content: reply });
    setSessionId(newSessionId);
  },
  onError: (error) => {
    // Show error in chat or banner
    addMessage({ role: 'system', content: error });
  },
});
```

### Agent Editor Preview — Visual Only

The agent editor preview (`chat-widget-surface.tsx`) is strictly for **visual preview**. No real voice functionality:

- Shows the mic button with correct theme colors/styling when `voiceEnabled` is toggled on in the form
- Clicking the mic button in preview **cycles through visual states** (idle → listening animation → processing spinner → playing icon → back to idle) so the user can see how each state looks with their theme
- No `useVoice` hook, no MediaRecorder, no API calls
- This keeps the preview lightweight and avoids microphone permission prompts while editing themes

### Browser Compatibility

`MediaRecorder` with `audio/webm` is supported in:
- Chrome 49+, Edge 79+, Firefox 25+, Safari 14.1+
- Not supported in older Safari/iOS — `isSupported` flag handles this gracefully

Check with:
```typescript
const isSupported = typeof window !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia
  && !!window.MediaRecorder;
```

### What NOT to Do

- **Do NOT** implement audio visualization/waveform — a simple pulse animation is sufficient for now
- **Do NOT** add language selection UI — that's story 10-12
- **Do NOT** implement voice settings/configuration UI — that's story 10-10
- **Do NOT** store audio recordings anywhere — only the transcribed text is stored (via ChatService)
- **Do NOT** build this as a Preact widget component — target Next.js only (Preact widget is Epic 5, backlog)
- **Do NOT** add audio processing (noise cancellation, gain control) — send raw MediaRecorder output

### Dependencies

- **Requires story 10-7** (voice conversation API endpoint)
- Uses `POST /voice/conversation` endpoint from 10-7
- Uses existing demo page from story 4-17
- Uses existing agent editor preview from story 4-11
- Agent must have `voiceEnabled: true` (from story 10-6) for mic button to appear

### Project Structure Notes

- Hook: `apps/web/hooks/use-voice.ts` (new)
- Mic button: `apps/web/components/features/chat/voice-mic-button.tsx` (new)
- Error banner: `apps/web/components/features/chat/voice-error-banner.tsx` (new)
- API helper: `apps/web/lib/voice-api.ts` (new)
- Demo page update: `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` (modify)
- Preview update: `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` (modify)

### References

- [Architecture: Section 20.10 - Widget Voice UI State Machine](_bmad-output/planning-artifacts/architecture.md)
- [Demo page](apps/web/app/agents/demo/[agentId]/demo-page-client.tsx) — current chat UI
- [Agent editor preview](apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx) — widget preview
- [Story 10-7: Voice Controller](_bmad-output/implementation-artifacts/10-7-voice-controller-full-conversation-endpoint.md) — API endpoint
- [Story 10-6: Voice Config Schema](_bmad-output/implementation-artifacts/10-6-voice-configuration-schema-database.md) — `voiceEnabled` flag
- [MDN MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Lint caught unused `Volume2` import in voice-mic-button.tsx — removed (using `Square` icon for stop in both listening and playing states)

### Completion Notes List
- Task 6: Created `apps/web/lib/voice-api.ts` — typed API helper with `sendVoiceConversation()`, `VoiceConversationResponse` type matching 10-7 endpoint, and `VoiceApiError` class for error handling (rate limit, validation, server errors)
- Task 1: Created `apps/web/hooks/use-voice.ts` — 4-state machine (`idle → listening → processing → playing`), MediaRecorder with `audio/webm`, 60s auto-stop, duration tracking at 100ms intervals, mic permission error handling, base64 audio playback via `HTMLAudioElement`, auto-dismiss errors after 5s, full cleanup on unmount
- Task 2: Created `apps/web/components/features/chat/voice-mic-button.tsx` — state-specific icons (Mic/Square/Loader2/Square), pulse animation during listening, recording duration timer, aria-labels per state, sr-only live region for state announcements
- Task 3: Created `apps/web/components/features/chat/voice-error-banner.tsx` — inline error display near mic button with dismiss button, role="alert" for accessibility
- Task 4: Updated demo page — added `voiceConfig` to `AgentDemoInfo` interface (API already returns it), conditionally renders VoiceMicButton when voice enabled + browser supported, wires `onTranscription`/`onResponse` callbacks to add messages to chat, disables text input during voice states, shows VoiceErrorBanner on errors
- Task 5: Updated agent editor preview — added `voiceEnabled` to `PreviewFormData` and `toPreviewFormData()`, preview mic button cycles through visual states on click (idle → listening → processing → playing), themed using `sendButtonBg`/`sendButtonBorderRadius`/`sendButtonIconColor`, no real recording or API calls

### Change Log
- 2026-03-21: Implemented all 6 tasks for story 10-8 Voice UI State Machine & Mic Button

### File List
- `apps/web/lib/voice-api.ts` (new)
- `apps/web/hooks/use-voice.ts` (new)
- `apps/web/components/features/chat/voice-mic-button.tsx` (new)
- `apps/web/components/features/chat/voice-error-banner.tsx` (new)
- `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` (modified)
- `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` (modified)
- `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` (modified)
