import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { WebSocket } from 'undici';
import type {
  VoiceProvider,
  STTRequest,
  STTResponse,
  TTSRequest,
  TTSResponse,
  TTSStreamChunk,
  TTSSession,
  TTSSessionConfig,
  LanguageDetectionResponse,
  SupportedLanguage,
  VoiceListItem,
} from './voice-provider.interface';
import { VoiceProviderError } from './voice-provider.interface';

/** Sarvam bulbul:v3 speaker catalog (verified against the live API error response).
 *  Update if Sarvam ships new speakers. */
const SARVAM_BULBUL_V3_VOICES: ReadonlyArray<VoiceListItem> = [
  { id: 'aayan',    name: 'Aayan',    gender: 'male' },
  { id: 'aditya',   name: 'Aditya',   gender: 'male' },
  { id: 'advait',   name: 'Advait',   gender: 'male' },
  { id: 'amit',     name: 'Amit',     gender: 'male' },
  { id: 'anand',    name: 'Anand',    gender: 'male' },
  { id: 'ashutosh', name: 'Ashutosh', gender: 'male' },
  { id: 'dev',      name: 'Dev',      gender: 'male' },
  { id: 'gokul',    name: 'Gokul',    gender: 'male' },
  { id: 'ishita',   name: 'Ishita',   gender: 'female' },
  { id: 'kabir',    name: 'Kabir',    gender: 'male' },
  { id: 'kavitha',  name: 'Kavitha',  gender: 'female' },
  { id: 'kavya',    name: 'Kavya',    gender: 'female' },
  { id: 'mani',     name: 'Mani',     gender: 'male' },
  { id: 'manan',    name: 'Manan',    gender: 'male' },
  { id: 'mohit',    name: 'Mohit',    gender: 'male' },
  { id: 'neha',     name: 'Neha',     gender: 'female' },
  { id: 'niharika', name: 'Niharika', gender: 'female' },
  { id: 'pooja',    name: 'Pooja',    gender: 'female' },
  { id: 'priya',    name: 'Priya',    gender: 'female' },
  { id: 'rahul',    name: 'Rahul',    gender: 'male' },
  { id: 'ratan',    name: 'Ratan',    gender: 'male' },
  { id: 'rehan',    name: 'Rehan',    gender: 'male' },
  { id: 'ritu',     name: 'Ritu',     gender: 'female' },
  { id: 'rohan',    name: 'Rohan',    gender: 'male' },
  { id: 'roopa',    name: 'Roopa',    gender: 'female' },
  { id: 'rupali',   name: 'Rupali',   gender: 'female' },
  { id: 'shreya',   name: 'Shreya',   gender: 'female' },
  { id: 'shruti',   name: 'Shruti',   gender: 'female' },
  { id: 'shubh',    name: 'Shubh',    gender: 'male' },
  { id: 'simran',   name: 'Simran',   gender: 'female' },
  { id: 'soham',    name: 'Soham',    gender: 'male' },
  { id: 'suhani',   name: 'Suhani',   gender: 'female' },
  { id: 'sumit',    name: 'Sumit',    gender: 'male' },
  { id: 'sunny',    name: 'Sunny',    gender: 'male' },
  { id: 'tanya',    name: 'Tanya',    gender: 'female' },
  { id: 'tarun',    name: 'Tarun',    gender: 'male' },
  { id: 'varun',    name: 'Varun',    gender: 'male' },
  { id: 'vijay',    name: 'Vijay',    gender: 'male' },
];

const SARVAM_DEFAULT_SPEAKER = 'priya';

interface SarvamSTTResponse {
  request_id: string | null;
  transcript: string;
  language_code: string | null;
  language_probability: number | null;
  timestamps: {
    words: string[];
    start_time_seconds: number[];
    end_time_seconds: number[];
  } | null;
}

interface SarvamTTSResponse {
  request_id: string;
  audios: string[];
}

interface SarvamErrorResponse {
  error: {
    request_id: string | null;
    message: string;
    code: string;
  };
}

@Injectable()
export class SarvamProvider implements VoiceProvider {
  private readonly logger = new Logger(SarvamProvider.name);
  private readonly apiKey: string;

  readonly name = 'sarvam';
  readonly supportedLanguages: SupportedLanguage[] = [
    'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'en', 'hinglish',
  ];

  private readonly LANGUAGE_MAP: Record<string, string> = {
    'hi': 'hi-IN',
    'mr': 'mr-IN',
    'bn': 'bn-IN',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'gu': 'gu-IN',
    'kn': 'kn-IN',
    'ml': 'ml-IN',
    'pa': 'pa-IN',
    'or': 'od-IN',
    'en': 'en-IN',
    'hinglish': 'unknown',
  };

  private readonly REVERSE_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
    'hi-IN': 'hi',
    'mr-IN': 'mr',
    'bn-IN': 'bn',
    'ta-IN': 'ta',
    'te-IN': 'te',
    'gu-IN': 'gu',
    'kn-IN': 'kn',
    'ml-IN': 'ml',
    'pa-IN': 'pa',
    'od-IN': 'or',
    'en-IN': 'en',
  };

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SARVAM_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn('SARVAM_API_KEY not configured — Sarvam provider will not work');
    }
  }

  private toSarvamLanguage(language?: string): string {
    if (!language) return 'unknown';
    const mapped = this.LANGUAGE_MAP[language];
    if (!mapped) {
      this.logger.warn(`Unmapped language code "${language}" — falling back to auto-detect`);
      return 'unknown';
    }
    return mapped;
  }

  private fromSarvamLanguage(sarvamCode: string | null): SupportedLanguage {
    if (!sarvamCode) return 'en';
    return this.REVERSE_LANGUAGE_MAP[sarvamCode] || 'en';
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const startTime = Date.now();

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(request.audio)]), 'audio.webm');
    formData.append('model', 'saarika:v2.5');
    formData.append('language_code', this.toSarvamLanguage(request.languageHint));

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamSTTResponse;

    return {
      transcript: data.transcript,
      confidence: data.language_probability ?? 0,
      detectedLanguage: this.fromSarvamLanguage(data.language_code),
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithCodec(request, 'mp3', 'audio/mp3');
  }

  /** Preview synthesis returns WAV instead of MP3 — MP3's mandatory ~24-45ms leading
   *  priming silence (per spec) clips the first consonant on one-shot dropdown playback.
   *  WAV has no priming. Production conversation traffic stays on MP3 via synthesize(). */
  async synthesizePreview(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithCodec(request, 'wav', 'audio/wav');
  }

  private async synthesizeWithCodec(
    request: TTSRequest,
    sarvamCodec: 'mp3' | 'wav',
    audioFormat: string,
  ): Promise<TTSResponse> {
    const startTime = Date.now();
    const targetLanguageCode = this.toSarvamLanguage(request.language);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': this.apiKey,
      },
      body: JSON.stringify({
        text: request.text,
        target_language_code: targetLanguageCode,
        model: 'bulbul:v3',
        speaker: request.voiceId || SARVAM_DEFAULT_SPEAKER,
        pace: request.speed || 1.0,
        // 24000 Hz is bulbul:v3's native rate. See WS provider comment for why
        // mismatching this with the audioFormat tag causes pitch shift.
        speech_sample_rate: '24000',
        output_audio_codec: sarvamCodec,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamTTSResponse;
    const base64Audio = data.audios[0];
    if (!base64Audio) {
      throw new VoiceProviderError(this.name, 'Empty audio response from Sarvam TTS');
    }
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    return {
      audio: audioBuffer,
      audioFormat,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * WebSocket streaming TTS via Sarvam Bulbul v3.
   *
   * Endpoint: wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3
   * Auth: subprotocol `api-subscription-key.{key}` — Sarvam's recommended
   * pattern, also what Pipecat's reference impl uses (verified against
   * pipecat-ai/pipecat PR #2356).
   *
   * Protocol:
   *   1. Open WS with subprotocol auth.
   *   2. Send `config` once (target_language_code, speaker, codec, etc.).
   *   3. Send `text` with the sentence content.
   *   4. Send `flush` to force emission (overrides min_buffer_size).
   *   5. Receive `audio` chunks as the model renders.
   *   6. Receive an `event` chunk on completion (send_completion_event: true).
   *   7. Close cleanly.
   *
   * Audio format: `mp3` — matches ElevenLabs's MP3 stream so the upstream
   * VoiceService can treat both providers identically when concatenating
   * chunks server-side or forwarding per-chunk to clients.
   *
   * Reliability: this method `throw`s on any WS protocol error so the caller
   * (VoiceService.streamingTTS) can fall back to batch `synthesize()` for
   * that sentence — keeps voice replies working even when WS is degraded.
   */
  async *synthesizeStream(request: TTSRequest): AsyncIterable<TTSStreamChunk> {
    const startTime = Date.now();
    const targetLanguageCode = this.toSarvamLanguage(request.language);

    const url = new URL('wss://api.sarvam.ai/text-to-speech/ws');
    url.searchParams.set('model', 'bulbul:v3');
    // CRITICAL: send_completion_event MUST go on the URL — Sarvam ignores it
    // inside the config body. Verified against LiveKit's working Sarvam TTS
    // plugin (livekit-agents/livekit-plugins-sarvam/.../tts.py line 596):
    //   ws_url = f"{url}?model={model}&send_completion_event={true}"
    // Without this, the server never emits `type: event, event_type: final`
    // and consumers fall back to inactivity-timeout heuristics — which was
    // exactly what we were doing before.
    url.searchParams.set('send_completion_event', 'true');

    const queue: TTSStreamChunk[] = [];
    let wsClosed = false;
    let wsError: Error | null = null;
    let completionReceived = false;
    let firstChunkSeen = false;
    let wakeResolver: (() => void) | null = null;
    const waitForChunk = (): Promise<void> =>
      new Promise<void>((resolve) => {
        wakeResolver = resolve;
      });
    const notify = (): void => {
      if (wakeResolver) {
        const r = wakeResolver;
        wakeResolver = null;
        r();
      }
    };

    // Subprotocol auth — see Pipecat reference impl.
    const ws = new WebSocket(url, [`api-subscription-key.${this.apiKey}`]);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'config',
          data: {
            target_language_code: targetLanguageCode,
            speaker: request.voiceId || SARVAM_DEFAULT_SPEAKER,
            model: 'bulbul:v3',
            // 24000 Hz is bulbul:v3's NATIVE sample rate (per pipecat's
            // TTS_MODEL_CONFIGS and LiveKit's plugin). We previously hardcoded
            // 22050 (bulbul:v2's native rate) which caused voice to sound
            // deeper / inconsistent across sentences — Sarvam was emitting
            // 24000 Hz audio but we tagged it as 22050 Hz, so the client
            // played it slower and the pitch dropped.
            speech_sample_rate: 24000,
            // WAV codec — Sarvam prepends a 44-byte RIFF header on the very
            // first audio chunk; subsequent chunks are bare PCM samples. We
            // strip that header below so every chunk we emit is independently
            // playable raw PCM (16-bit signed LE, 24kHz, mono). Matches
            // the format-per-chunk contract ElevenLabs uses via pcm_24000.
            output_audio_codec: 'wav',
            pace: request.speed || 1.0,
            // NB: send_completion_event lives on the URL (see above), NOT in
            // the config body — Sarvam ignores it here.
          },
        }),
      );
      ws.send(JSON.stringify({ type: 'text', data: { text: request.text } }));
      ws.send(JSON.stringify({ type: 'flush' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = (event as unknown as { data: string | Buffer | ArrayBuffer }).data;
        const raw =
          typeof data === 'string'
            ? data
            : data instanceof Buffer
              ? data.toString('utf-8')
              : new TextDecoder().decode(data);
        const parsed = JSON.parse(raw) as {
          type?: string;
          data?: { audio?: string; event_type?: string; message?: string };
          event?: string;
        };
        if (parsed.type === 'audio' && parsed.data?.audio) {
          let pcm = Buffer.from(parsed.data.audio, 'base64');
          // First chunk has a 44-byte WAV header (RIFF...fmt ...data...). Strip
          // it so every chunk we emit is independently-playable raw PCM. Be
          // defensive: only strip if the header magic is actually present —
          // older Sarvam responses occasionally omitted it.
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            if (pcm.length >= 44 && pcm.subarray(0, 4).toString('ascii') === 'RIFF') {
              pcm = pcm.subarray(44);
            }
          }
          if (pcm.length > 0) {
            queue.push({
              audio: pcm,
              // Raw PCM 24000 Hz 16-bit signed little-endian.
              audioFormat: 'audio/pcm; rate=24000',
              latencyMs: Date.now() - startTime,
              isFinal: false,
              provider: this.name,
            });
            resetInactivityTimer();
            notify();
          }
        } else if (parsed.type === 'event' && parsed.data?.event_type === 'final') {
          // Completion event signals all text we've sent has been emitted as
          // audio. Mark the last queued chunk as final (or queue a marker if
          // empty — defensive) and close. Per LiveKit's Sarvam plugin, the
          // event we care about is specifically `event_type: 'final'`; ignore
          // other event types (none documented yet, but defensive).
          completionReceived = true;
          if (queue.length > 0) {
            queue[queue.length - 1]!.isFinal = true;
          }
          try {
            ws.close();
          } catch {
            // ignore
          }
          notify();
        } else if (parsed.type === 'error') {
          wsError = new Error(`Sarvam WS error: ${raw}`);
          wsClosed = true;
          notify();
        }
      } catch (err) {
        wsError = err instanceof Error ? err : new Error(String(err));
        wsClosed = true;
        notify();
      }
    });

    ws.addEventListener('error', () => {
      wsError = new Error('Sarvam WebSocket connection error');
      wsClosed = true;
      notify();
    });

    ws.addEventListener('close', () => {
      wsClosed = true;
      // If the server closed before sending a completion event AND we got
      // chunks, mark the last as final so the consumer terminates cleanly.
      if (!completionReceived && queue.length > 0) {
        queue[queue.length - 1]!.isFinal = true;
      }
      notify();
    });

    // Sarvam's WS auto-closes after ~1 minute of inactivity. Per their docs,
    // clients must send a `ping` to keep the connection alive while
    // synthesis is in progress. Pipecat sends ping every 20s; we mirror that.
    // Without this, long sentences (>20s of audio = ~100+ chunks) had their
    // connection terminated mid-stream by Sarvam, even though we were
    // actively receiving data.
    // Ref: https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api/web-socket
    const PING_INTERVAL_MS = 20_000;
    const pingInterval = setInterval(() => {
      if (!wsClosed) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // If the WS is already closing, send() throws — fine, the close
          // handler will clean up the interval below.
        }
      }
    }, PING_INTERVAL_MS);

    // Inactivity timeout — Sarvam's bulbul:v3 endpoint doesn't reliably send
    // the `type: 'event' event_type: 'final'` completion message despite
    // `send_completion_event: true` in the config (observed: 111 audio chunks
    // delivered cleanly, then radio silence, no completion event ever).
    //
    // Pipecat's reference impl treats connection silence as "synthesis
    // complete" rather than waiting for the event (per their docs). We mirror:
    //   - 2.5s of no chunks AFTER we've received at least one → graceful
    //     completion (mark last chunk as final, close, no error)
    //   - 12s of no chunks WHEN we have ZERO chunks yet → real failure
    //     (connection hung at open or first-chunk; surface as error)
    //
    // Chunks normally arrive every 30-100ms (Sarvam runs ~3x real-time), so
    // 2.5s of silence is unambiguously "Sarvam is done sending."
    const INACTIVITY_DONE_MS = 2_500;
    const INITIAL_TIMEOUT_MS = 12_000;
    let inactivityHandle: NodeJS.Timeout | null = null;
    const resetInactivityTimer = (): void => {
      if (inactivityHandle) clearTimeout(inactivityHandle);
      const ms = firstChunkSeen ? INACTIVITY_DONE_MS : INITIAL_TIMEOUT_MS;
      inactivityHandle = setTimeout(() => {
        if (wsClosed) return;
        if (firstChunkSeen) {
          // Graceful completion: we received chunks, then Sarvam went silent.
          // That's "done synthesising" — treat as success, mark last chunk as
          // final (mirrors the `type: 'event'` branch). No error surfaced.
          completionReceived = true;
          if (queue.length > 0) {
            queue[queue.length - 1]!.isFinal = true;
          }
          try {
            ws.close();
          } catch {
            // ignore
          }
        } else {
          // No chunks ever received within INITIAL_TIMEOUT_MS — real failure.
          wsError = new Error(
            `Sarvam WebSocket initial timeout (${INITIAL_TIMEOUT_MS}ms with no audio)`,
          );
          wsClosed = true;
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
        notify();
      }, ms);
    };
    resetInactivityTimer();

    try {
      while (true) {
        while (queue.length > 0) {
          const chunk = queue.shift()!;
          yield chunk;
          if (chunk.isFinal) return;
        }
        if (wsClosed) {
          if (wsError) throw wsError;
          return;
        }
        await waitForChunk();
      }
    } finally {
      if (inactivityHandle) clearTimeout(inactivityHandle);
      clearInterval(pingInterval);
      if (!wsClosed) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Persistent WebSocket session — open once per voice turn, synthesize N
   * sentences without per-sentence WS handshake.
   *
   * Wire pattern (verified against pipecat + LiveKit Sarvam plugins):
   *   1. Open ONE WS with `send_completion_event=true` in URL query.
   *   2. Send `{type: 'config', data: {...}}` once on open.
   *   3. Per sentence: `{type: 'text', data: {text}}` then `{type: 'flush'}`.
   *   4. Stream audio chunks. Sarvam emits `{type: 'event', data:
   *      {event_type: 'final'}}` after each sentence's chunks are done.
   *   5. Repeat for next sentence on the same WS.
   *   6. On close: send nothing, just close the WS.
   *
   * The per-sentence handshake savings (~150-300ms) eliminates the audible
   * gap between sentences that's noticeable on short ones like "Certainly.".
   */
  async openSynthesisSession(config: TTSSessionConfig): Promise<TTSSession> {
    const startTime = Date.now();
    const targetLanguageCode = this.toSarvamLanguage(config.language);
    const url = new URL('wss://api.sarvam.ai/text-to-speech/ws');
    url.searchParams.set('model', 'bulbul:v3');
    url.searchParams.set('send_completion_event', 'true');

    const ws = new WebSocket(url, [`api-subscription-key.${this.apiKey}`]);

    // Per-sentence state. Resets each time `synthesize()` is called.
    // `currentQueue` holds chunks for the active sentence (since the last
    // flush). `currentResolver` wakes up the consumer when a new chunk lands.
    // `currentDone` flips true when `event_type: 'final'` arrives — terminates
    // the active sentence's async-iterable.
    type PendingChunk = { audio: Buffer; audioFormat: string; latencyMs: number };
    let currentQueue: PendingChunk[] = [];
    let currentDone = false;
    let currentResolver: (() => void) | null = null;
    const wakeCurrent = (): void => {
      if (currentResolver) {
        const r = currentResolver;
        currentResolver = null;
        r();
      }
    };

    // Session-level state (vs per-sentence).
    let wsOpened = false;
    let wsFatalError: Error | null = null;
    let wsClosed = false;
    let firstChunkOfSentence = true;
    // Resolves when the WS hits 'open'. `synthesize()` awaits this before
    // sending text so the config message lands first.
    let onOpen!: () => void;
    let onOpenError!: (e: Error) => void;
    const openPromise = new Promise<void>((res, rej) => {
      onOpen = res;
      onOpenError = rej;
    });

    ws.addEventListener('open', () => {
      try {
        ws.send(
          JSON.stringify({
            type: 'config',
            data: {
              target_language_code: targetLanguageCode,
              speaker: config.voiceId || SARVAM_DEFAULT_SPEAKER,
              model: 'bulbul:v3',
              // 24kHz is bulbul:v3's NATIVE rate. Mismatching (we used to
              // request 22050) makes Sarvam emit at the model's native rate
              // but we tag audioFormat as 22050 → client plays slower →
              // voice sounds deeper. Match the model's native rate.
              speech_sample_rate: 24000,
              output_audio_codec: 'wav',
              pace: config.speed || 1.0,
            },
          }),
        );
        wsOpened = true;
        onOpen();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        wsFatalError = err;
        onOpenError(err);
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = (event as unknown as { data: string | Buffer | ArrayBuffer }).data;
        const raw =
          typeof data === 'string'
            ? data
            : data instanceof Buffer
              ? data.toString('utf-8')
              : new TextDecoder().decode(data);
        const parsed = JSON.parse(raw) as {
          type?: string;
          data?: { audio?: string; event_type?: string; message?: string };
        };
        if (parsed.type === 'audio' && parsed.data?.audio) {
          let pcm = Buffer.from(parsed.data.audio, 'base64');
          // First audio chunk OF EACH SENTENCE has the 44-byte RIFF/WAV
          // header prepended. Strip it so every emitted chunk is independently
          // playable raw PCM. Each `synthesize()` call resets this flag.
          if (firstChunkOfSentence) {
            firstChunkOfSentence = false;
            if (pcm.length >= 44 && pcm.subarray(0, 4).toString('ascii') === 'RIFF') {
              pcm = pcm.subarray(44);
            }
          }
          if (pcm.length > 0) {
            currentQueue.push({
              audio: pcm,
              audioFormat: 'audio/pcm; rate=24000',
              latencyMs: Date.now() - startTime,
            });
            wakeCurrent();
          }
        } else if (parsed.type === 'event' && parsed.data?.event_type === 'final') {
          // End of THIS sentence's audio. Mark current sentence done; WS stays
          // open for the next `synthesize()` call.
          currentDone = true;
          wakeCurrent();
        } else if (parsed.type === 'error') {
          wsFatalError = new Error(`Sarvam WS error: ${parsed.data?.message ?? raw}`);
          wsClosed = true;
          currentDone = true;
          wakeCurrent();
        }
      } catch (err) {
        wsFatalError = err instanceof Error ? err : new Error(String(err));
        wsClosed = true;
        currentDone = true;
        wakeCurrent();
      }
    });

    ws.addEventListener('error', () => {
      wsFatalError = new Error('Sarvam WebSocket connection error');
      wsClosed = true;
      currentDone = true;
      wakeCurrent();
      if (!wsOpened) onOpenError(wsFatalError);
    });

    ws.addEventListener('close', () => {
      wsClosed = true;
      currentDone = true;
      wakeCurrent();
    });

    // Keepalive ping every 20s (Sarvam's docs: connection auto-closes after
    // ~1 min idle; pipecat uses 20s).
    const pingInterval = setInterval(() => {
      if (!wsClosed && wsOpened) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, 20_000);

    // Wait for the WS to open (or fail fast).
    await openPromise;

    const provider = this.name;
    const session: TTSSession = {
      provider,
      async *synthesize(text: string): AsyncIterable<TTSStreamChunk> {
        if (wsClosed) {
          throw new VoiceProviderError(
            provider,
            wsFatalError?.message ?? 'Sarvam session already closed',
          );
        }
        // Reset per-sentence state. Previous sentence's chunks should be
        // fully consumed by the time the caller invokes synthesize() again
        // (the contract in the interface doc).
        currentQueue = [];
        currentDone = false;
        firstChunkOfSentence = true;

        // Send the sentence's text + flush so Sarvam starts emitting audio
        // immediately (vs waiting for `min_buffer_size` worth of text).
        ws.send(JSON.stringify({ type: 'text', data: { text } }));
        ws.send(JSON.stringify({ type: 'flush' }));

        while (true) {
          while (currentQueue.length > 0) {
            const c = currentQueue.shift()!;
            yield {
              audio: c.audio,
              audioFormat: c.audioFormat,
              latencyMs: c.latencyMs,
              isFinal: false,
              provider,
            };
          }
          if (currentDone) {
            if (wsFatalError) throw wsFatalError;
            return;
          }
          // Wait for next chunk or 'final' event. No artificial timeout here
          // — Sarvam reliably emits `event_type: 'final'` once we set the
          // URL param. If the WS dies, the close handler flips currentDone +
          // sets wsFatalError, which we throw above.
          await new Promise<void>((resolve) => {
            currentResolver = resolve;
          });
        }
      },
      async close() {
        clearInterval(pingInterval);
        if (!wsClosed) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          wsClosed = true;
        }
      },
    };
    return session;
  }

  async listVoices(): Promise<VoiceListItem[]> {
    // Sarvam exposes no /voices catalog endpoint — speakers are baked into the model spec.
    // Returning the static catalog keeps the dropdown UX consistent with ElevenLabs.
    return SARVAM_BULBUL_V3_VOICES.map((v) => ({ ...v }));
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const startTime = Date.now();
    this.logger.debug(`detectLanguage called (format: ${audioFormat}, size: ${audio.length})`);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.webm');
    formData.append('model', 'saarika:v2.5');
    formData.append('language_code', 'unknown');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamSTTResponse;

    return {
      detectedLanguage: this.fromSarvamLanguage(data.language_code),
      confidence: data.language_probability ?? 0,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  private handleNetworkError(error: Error): VoiceProviderError {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new VoiceProviderError(
        this.name,
        'Request timed out after 10s',
        HttpStatus.GATEWAY_TIMEOUT,
        error,
      );
    }
    return new VoiceProviderError(
      this.name,
      `Network error: ${error.message}`,
      HttpStatus.BAD_GATEWAY,
      error,
    );
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: SarvamErrorResponse | undefined;
    try {
      errorData = (await response.json()) as SarvamErrorResponse;
    } catch {
      throw new VoiceProviderError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const code = errorData?.error?.code;
    const message = errorData?.error?.message || `HTTP ${response.status}`;

    this.logger.error(`Sarvam API error: ${code} — ${message}`);

    switch (code) {
      case 'invalid_api_key_error':
      case 'authentication_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.UNAUTHORIZED);
      case 'rate_limit_exceeded_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.TOO_MANY_REQUESTS);
      case 'invalid_request_error':
      case 'unprocessable_entity_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_REQUEST);
      case 'internal_server_error':
      default:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_GATEWAY);
    }
  }
}
