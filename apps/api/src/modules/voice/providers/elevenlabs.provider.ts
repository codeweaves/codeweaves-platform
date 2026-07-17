import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { WebSocket } from 'undici';
import { AppLogger } from '../../../common/logger/app-logger';
import { ProviderEventLogger, PROVIDERS } from '../../../common/events/provider.logger';
import type {
  VoiceProvider,
  STTRequest,
  STTResponse,
  TTSRequest,
  TTSResponse,
  TTSStreamChunk,
  LanguageDetectionResponse,
  SupportedLanguage,
  VoiceListItem,
} from './voice-provider.interface';
import { VoiceProviderError } from './voice-provider.interface';

interface ElevenLabsSTTResponse {
  language_code: string;
  language_probability: number;
  text: string;
  words: Array<{
    text: string;
    start: number;
    end: number;
    type: string;
    speaker_id?: string;
  }>;
}

interface ElevenLabsErrorResponse {
  detail: {
    status: string;
    message: string;
  };
}

interface ElevenLabsVoiceListResponse {
  voices: Array<{
    voice_id: string;
    name: string;
    preview_url?: string | null;
    labels?: Record<string, string> | null;
    category?: string | null;
    high_quality_base_model_ids?: string[] | null;
  }>;
}

/** Maps ElevenLabs `labels.language` (or accent fallback) to our SupportedLanguage codes. */
const ELEVENLABS_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  english: 'en',
  hindi: 'hi',
  tamil: 'ta',
};

// Turbo v2.5 over Multilingual v2: independently measured 264ms TTFT vs
// 1232ms on Coval/Gradium benchmark, 0.5 credits/char vs 1 credit/char on the
// ElevenLabs free tier, and supports the same 32 languages including Hindi /
// Marathi / Tamil. Quality WER 5.2% vs 3.9% — small drop, but for short
// chatbot replies that drop is imperceptible against the 5× latency win.
const ELEVENLABS_TTS_MODEL = 'eleven_turbo_v2_5';

@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  private readonly log = new AppLogger(ElevenLabsProvider.name);
  private readonly apiKey: string;
  private readonly defaultVoiceId: string;

  /**
   * ElevenLabs enforces a subscription-tier concurrency cap on TTS (2 concurrent
   * on the starter plan, higher on paid tiers). When we exceeded this, the
   * provider returned 429 and fell back to Sarvam mid-response — causing an
   * audible voice switch mid-reply. We gate synthesize() with a simple
   * promise-chain semaphore sized to the plan limit, so concurrent callers
   * queue at our edge instead of hitting the rate limit.
   *
   * Configurable via ELEVENLABS_MAX_CONCURRENT (default 2, matching starter plan).
   * If you upgrade the plan, bump this env var accordingly.
   */
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private readonly waitQueue: Array<() => void> = [];

  readonly name = 'elevenlabs';
  readonly supportedLanguages: SupportedLanguage[] = [
    'en', 'hi', 'ta', // Multilingual v2 only supports Hindi + Tamil from Indian languages
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY') || '';
    this.defaultVoiceId =
      this.configService.get<string>('ELEVENLABS_DEFAULT_VOICE_ID') || 'Xb7hH8MSUJpSbSDYk0k2';
    const configured = this.configService.get<string>('ELEVENLABS_MAX_CONCURRENT');
    const parsed = configured ? parseInt(configured, 10) : NaN;
    this.maxConcurrent = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

    if (!this.apiKey) {
      this.log.warn('constructor', 'ELEVENLABS_API_KEY not configured — ElevenLabs provider will not work');
    }
  }

  /**
   * Acquire a concurrency slot. Resolves immediately if under the cap,
   * otherwise queues until a prior call releases. FIFO ordering preserved so
   * sentence 0 doesn't get starved by later sentences jumping the queue.
   */
  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.inFlight--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    this.log.debug('transcribe', 'STT request', {
      agentId: request.agentId,
      languageHint: request.languageHint,
      audioBytes: request.audio.length,
    });

    return this.providerLog.traced<STTResponse>(
      {
        channel: 'VOICE',
        provider: PROVIDERS.ELEVENLABS,
        eventBase: 'ELEVENLABS_STT',
        agentId: request.agentId,
        sessionId: request.sessionId,
        requestUrl: 'https://api.elevenlabs.io/v1/speech-to-text',
        requestPayload: {
          audioBytes: request.audio.length,
          audioMime: request.audioFormat,
          languageHint: request.languageHint,
        },
        extract: (r) => ({
          responsePayload: {
            transcriptChars: r.transcript.length,
            detectedLanguage: r.detectedLanguage,
            confidence: r.confidence,
          },
          metadata: { latencyMs: r.latencyMs },
        }),
      },
      async () => {
        const startTime = Date.now();

        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(request.audio)]), 'audio.webm');
        formData.append('model_id', 'scribe_v2');
        if (request.languageHint) {
          formData.append('language_code', request.languageHint);
        }

        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
          },
          body: formData,
          signal: AbortSignal.timeout(10_000),
        }).catch((error: Error) => {
          throw this.handleNetworkError(error, 'transcribe');
        });

        if (!response.ok) {
          await this.handleErrorResponse(response, 'transcribe');
        }

        const data = (await response.json()) as ElevenLabsSTTResponse;

        const result: STTResponse = {
          transcript: data.text,
          confidence: data.language_probability ?? 0,
          detectedLanguage: (data.language_code as SupportedLanguage) || 'en',
          provider: this.name,
          latencyMs: Date.now() - startTime,
        };
        this.log.info('transcribe', 'STT completed', {
          detectedLanguage: result.detectedLanguage,
          transcriptChars: result.transcript.length,
          latencyMs: result.latencyMs,
        });
        return result;
      },
    );
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithFormat(request, 'mp3_44100_128', 'audio/mp3', 'synthesize');
  }

  /** Preview synthesis returns Ogg Opus (free-tier compatible — wav_44100 needs Pro).
   *  Opus has a pre-skip field in its header that browsers always honor when decoding,
   *  so unlike MP3 there's no leading priming silence to clip the first consonant.
   *  Ref: https://medium.com/vimeo-engineering-blog/a-brief-history-of-gapless-audio-and-what-you-can-do-about-it-ea9e1c343215 */
  async synthesizePreview(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithFormat(request, 'opus_48000_32', 'audio/ogg', 'synthesizePreview');
  }

  private async synthesizeWithFormat(
    request: TTSRequest,
    elevenlabsFormat: string,
    audioFormat: string,
    operation: string,
  ): Promise<TTSResponse> {
    const voiceId = request.voiceId || this.defaultVoiceId;
    const sanitizedVoiceId = encodeURIComponent(voiceId);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${sanitizedVoiceId}?output_format=${elevenlabsFormat}`;
    this.log.debug('synthesizeWithFormat', 'TTS request', {
      agentId: request.agentId,
      operation,
      language: request.language,
      voiceId,
      textChars: request.text.length,
    });

    // Respect the subscription-tier concurrency cap. Blocks here until a slot
    // is free — prevents the 429 cascade that caused sentences 2-3 to fall
    // back to Sarvam (audible voice switch mid-reply).
    await this.acquireSlot();
    try {
      return await this.providerLog.traced<TTSResponse>(
        {
          channel: 'VOICE',
          provider: PROVIDERS.ELEVENLABS,
          eventBase: 'ELEVENLABS_TTS',
          agentId: request.agentId,
          sessionId: request.sessionId,
          requestUrl: url,
          requestPayload: {
            textChars: request.text.length,
            voiceId,
            format: audioFormat,
            language: request.language,
          },
          extract: (r) => ({
            metadata: { audioBytes: r.audio.length, format: r.audioFormat, latencyMs: r.latencyMs },
          }),
        },
        async () => {
          const startTime = Date.now();

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': this.apiKey,
            },
            body: JSON.stringify({
              text: request.text,
              model_id: ELEVENLABS_TTS_MODEL,
              language_code: request.language,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                speed: request.speed || 1.0,
              },
            }),
            signal: AbortSignal.timeout(15_000),
          }).catch((error: Error) => {
            throw this.handleNetworkError(error, operation);
          });

          if (!response.ok) {
            await this.handleErrorResponse(response, operation);
          }

          // CRITICAL: Response is raw binary audio, NOT JSON
          const arrayBuffer = await response.arrayBuffer();
          const audio = Buffer.from(arrayBuffer);

          this.log.info('synthesizeWithFormat', 'TTS completed', {
            operation,
            audioBytes: audio.length,
            format: audioFormat,
            latencyMs: Date.now() - startTime,
          });
          return {
            audio,
            audioFormat,
            provider: this.name,
            latencyMs: Date.now() - startTime,
          };
        },
      );
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * WebSocket streaming TTS.
   *
   * Wins vs batch synthesize(): the provider starts emitting audio chunks ~200ms
   * into the request (per ElevenLabs docs + independent benchmarks) instead of
   * waiting for the full sentence to render (~600ms+ for Turbo v2.5 batch HTTP).
   * The caller (VoiceService) decides whether to forward chunks to the client
   * as they arrive (true streaming UX) or collect server-side (foundation
   * mode — same UX as today but faster TTFB at the server boundary).
   *
   * Protocol (per https://elevenlabs.io/docs/eleven-api/concepts/latency):
   *   Open WS → send initial frame with voice_settings + auth → send the text
   *   → send EOS empty-text → receive audio chunks → server closes WS on isFinal.
   *
   * Audio format: `mp3_44100_128` — same as batch synthesize() so client
   * playback is bit-identical when chunks are concatenated.
   *
   * Fallback semantics: this method `throw`s on any WS protocol error; callers
   * MUST be ready to fall back to `synthesize()` to preserve reliability. The
   * concurrency-cap semaphore is shared with batch (paid-tier limit applies to
   * both transport modes per ElevenLabs).
   */
  async *synthesizeStream(request: TTSRequest): AsyncIterable<TTSStreamChunk> {
    await this.acquireSlot();
    const startTime = Date.now();
    // WS path emits ONE summary event at stream end (chunk count + total bytes)
    // rather than per-chunk — see report note. Track cumulative counters here.
    let emittedChunks = 0;
    let emittedBytes = 0;
    const voiceId = request.voiceId || this.defaultVoiceId;
    const sanitizedVoiceId = encodeURIComponent(voiceId);
    this.log.debug('synthesizeStream', 'opening ElevenLabs WS TTS stream', {
      agentId: request.agentId,
      language: request.language,
      voiceId,
      textChars: request.text.length,
    });

    const url = new URL(
      `wss://api.elevenlabs.io/v1/text-to-speech/${sanitizedVoiceId}/stream-input`,
    );
    url.searchParams.set('model_id', ELEVENLABS_TTS_MODEL);
    // Raw PCM 24kHz 16-bit signed LE. Each chunk is independently playable
    // (no MP3-style header dependency), so VoiceService can forward chunks
    // to the client as they arrive instead of collecting them server-side.
    // 24kHz mono = ~48KB/s — ~3x bandwidth vs MP3 128kbps but trivial at
    // chat-reply scale and the streaming-perception win is worth it.
    url.searchParams.set('output_format', 'pcm_24000');

    // ws bridge: undici WebSocket fires events; we bridge into an async queue
    // so callers can `for await` over chunks naturally.
    const queue: TTSStreamChunk[] = [];
    let wsClosed = false;
    let wsError: Error | null = null;
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

    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      // Initial frame: voice config + API key. The leading-space text triggers
      // ElevenLabs to set up the synthesis context; subsequent text frames
      // append to the synthesis input.
      ws.send(
        JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: request.speed || 1.0,
          },
          xi_api_key: this.apiKey,
        }),
      );
      // Send the actual text and EOS in one go — we have the full sentence
      // ready (sentence-bounded streaming). Once we move to token-streaming,
      // these would be multiple frames followed by a final empty-text EOS.
      ws.send(JSON.stringify({ text: request.text }));
      ws.send(JSON.stringify({ text: '' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        // Undici's WebSocket MessageEvent type doesn't match DOM's well; cast
        // and extract the payload by shape. Server-side WS always sends text
        // frames containing JSON for this endpoint, so we expect a string.
        const data = (event as unknown as { data: string | Buffer | ArrayBuffer }).data;
        const raw =
          typeof data === 'string'
            ? data
            : data instanceof Buffer
              ? data.toString('utf-8')
              : new TextDecoder().decode(data);
        const parsed = JSON.parse(raw) as { audio?: string | null; isFinal?: boolean };
        if (parsed.audio) {
          queue.push({
            audio: Buffer.from(parsed.audio, 'base64'),
            // Raw PCM 24kHz 16-bit signed little-endian. Client plays each
            // chunk via AudioContext.createBuffer (no decodeAudioData needed).
            audioFormat: 'audio/pcm; rate=24000',
            latencyMs: Date.now() - startTime,
            isFinal: !!parsed.isFinal,
            provider: this.name,
          });
          notify();
        }
        if (parsed.isFinal) {
          // Server sends a final message with isFinal:true and (usually) no
          // audio; close gracefully.
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      } catch (err) {
        wsError = err instanceof Error ? err : new Error(String(err));
        wsClosed = true;
        notify();
      }
    });

    ws.addEventListener('error', () => {
      // Undici WS doesn't pass a real Error object — we surface a generic
      // failure; the consumer falls back to batch synthesize().
      wsError = new Error('ElevenLabs WebSocket connection error');
      wsClosed = true;
      notify();
    });

    ws.addEventListener('close', (event) => {
      // Capture close code + reason so we can diagnose why EL is killing the
      // stream (rate limit, concurrency cap, auth, bad voice ID, etc.). The
      // 'error' event above is opaque per WS spec; the close event is where
      // the diagnostic info actually lives.
      // Common codes: 1000 normal, 1006 abnormal (network), 1008 policy
      // violation (rate/auth), 1011 server error, 4000+ provider-specific.
      const closeEvent = event as unknown as { code?: number; reason?: string };
      const code = closeEvent.code;
      const reason = closeEvent.reason;
      if (!wsError && (code === undefined || (code !== 1000 && code !== 1005))) {
        // Surface non-normal closures as errors so the consumer can react
        // (and operators can see the code in logs). Normal close (1000) or
        // no-status (1005) after we've already streamed audio is fine.
        wsError = new Error(
          `ElevenLabs WebSocket closed unexpectedly (code=${code ?? 'unknown'}${reason ? `, reason="${reason}"` : ''})`,
        );
      }
      // Temporarily logged at info (was debug) so we can see the close code
      // that's causing the mid-stream failure. Revert to debug once the EL WS
      // issue is diagnosed.
      this.log.info('synthesizeStream', 'ElevenLabs WS closed', {
        code: code ?? 'unknown',
        reason: reason ?? '',
        hadError: !!wsError,
      });
      wsClosed = true;
      notify();
    });

    // Safety: if WS hangs (no message in 15s) we throw to let caller fall back.
    const hardTimeout = setTimeout(() => {
      if (!wsClosed) {
        wsError = new Error('ElevenLabs WebSocket hard timeout (15s)');
        wsClosed = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        notify();
      }
    }, 15_000);

    try {
      while (true) {
        while (queue.length > 0) {
          const chunk = queue.shift()!;
          emittedChunks += 1;
          emittedBytes += chunk.audio.length;
          yield chunk;
          if (chunk.isFinal) return;
        }
        if (wsClosed) {
          if (wsError) throw wsError;
          // Closed cleanly without a final-chunk flag — emit a synthetic final
          // marker so consumers know the stream is done.
          return;
        }
        await waitForChunk();
      }
    } finally {
      clearTimeout(hardTimeout);
      if (!wsClosed) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      this.releaseSlot();
      // Single fire-and-forget summary for the whole WS synth (no per-chunk rows).
      // `wsError` is only ever assigned inside the WS event closures, which the
      // TS control-flow analysis for the finally can't see (it narrows to never)
      // — cast back to the declared type to read it.
      const streamErr = wsError as Error | null;
      this.providerLog.log({
        channel: 'VOICE',
        eventName: streamErr ? 'ELEVENLABS_TTS_STREAM_FAILED' : 'ELEVENLABS_TTS_STREAM_COMPLETED',
        direction: 'OUTBOUND',
        provider: PROVIDERS.ELEVENLABS,
        agentId: request.agentId,
        sessionId: request.sessionId,
        requestUrl: url.toString(),
        requestPayload: {
          textChars: request.text.length,
          voiceId,
          language: request.language,
        },
        latencyMs: Date.now() - startTime,
        success: !streamErr,
        errorMessage: streamErr?.message,
        metadata: {
          chunkCount: emittedChunks,
          totalBytes: emittedBytes,
          format: 'audio/pcm; rate=24000',
          protocol: 'websocket',
        },
      });
    }
  }

  async listVoices(): Promise<VoiceListItem[]> {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error, 'listVoices');
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, 'listVoices');
    }

    const data = (await response.json()) as ElevenLabsVoiceListResponse;

    return (data.voices ?? [])
      .filter((v) => {
        const compatibleModels = v.high_quality_base_model_ids ?? [];
        // Keep voices either explicitly compatible with our TTS model, or with an unknown
        // compatibility list (premade voices often omit this and still work).
        return compatibleModels.length === 0 || compatibleModels.includes(ELEVENLABS_TTS_MODEL);
      })
      .map((v): VoiceListItem => {
        const labels = v.labels ?? {};
        const languageLabel = (labels.language ?? labels.accent ?? '').toLowerCase();
        const language = ELEVENLABS_LANGUAGE_MAP[languageLabel];
        const gender = labels.gender as VoiceListItem['gender'] | undefined;

        // Build a human-readable descriptor from labels: combine description ("calm",
        // "deep"), use_case ("narration"), age ("young"), and accent. Gender is shown
        // separately. Skip ElevenLabs' top-level `category` ("premade"/"cloned") — not
        // useful UI copy. Cap at 3 parts to keep the dropdown row readable.
        const descriptionParts = [
          labels.description,
          labels.use_case,
          labels.age,
          labels.accent,
        ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        const category =
          descriptionParts.length > 0 ? descriptionParts.slice(0, 3).join(' · ') : undefined;

        return {
          id: v.voice_id,
          name: v.name,
          languages: language ? [language] : undefined,
          gender: gender && ['male', 'female', 'neutral'].includes(gender) ? gender : undefined,
          category,
          previewUrl: v.preview_url ?? undefined,
        };
      });
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    this.log.debug('detectLanguage', 'auto-detect request', { format: audioFormat, audioBytes: audio.length });

    return this.providerLog.traced<LanguageDetectionResponse>(
      {
        channel: 'VOICE',
        provider: PROVIDERS.ELEVENLABS,
        eventBase: 'ELEVENLABS_STT_DETECT',
        requestUrl: 'https://api.elevenlabs.io/v1/speech-to-text',
        requestPayload: { audioBytes: audio.length, audioMime: audioFormat },
        extract: (r) => ({
          responsePayload: { detectedLanguage: r.detectedLanguage, confidence: r.confidence },
          metadata: { latencyMs: r.latencyMs },
        }),
      },
      async () => {
        const startTime = Date.now();

        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.webm');
        formData.append('model_id', 'scribe_v2');
        // Omit language_code to let ElevenLabs auto-detect

        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
          },
          body: formData,
          signal: AbortSignal.timeout(10_000),
        }).catch((error: Error) => {
          throw this.handleNetworkError(error, 'detectLanguage');
        });

        if (!response.ok) {
          await this.handleErrorResponse(response, 'detectLanguage');
        }

        const data = (await response.json()) as ElevenLabsSTTResponse;

        const result: LanguageDetectionResponse = {
          detectedLanguage: (data.language_code as SupportedLanguage) || 'en',
          confidence: data.language_probability ?? 0,
          provider: this.name,
          latencyMs: Date.now() - startTime,
        };
        this.log.info('detectLanguage', 'detection completed', {
          detectedLanguage: result.detectedLanguage,
          latencyMs: result.latencyMs,
        });
        return result;
      },
    );
  }

  private handleNetworkError(error: Error, operation: string): VoiceProviderError {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      const timeout = operation === 'synthesize' ? '15s' : '10s';
      return new VoiceProviderError(
        this.name,
        `Request timed out after ${timeout}`,
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

  private async handleErrorResponse(response: Response, operation: string): Promise<never> {
    let errorData: ElevenLabsErrorResponse | undefined;
    try {
      errorData = (await response.json()) as ElevenLabsErrorResponse;
    } catch {
      throw new VoiceProviderError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const message = errorData?.detail?.message || `HTTP ${response.status}`;

    this.log.error('handleErrorResponse', 'ElevenLabs API error', undefined, {
      operation,
      status: response.status,
      message,
    });

    switch (response.status) {
      case 401:
        throw new VoiceProviderError(this.name, message, HttpStatus.UNAUTHORIZED);
      case 422:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_REQUEST);
      case 429:
        throw new VoiceProviderError(this.name, message, HttpStatus.TOO_MANY_REQUESTS);
      case 500:
      case 502:
      case 503:
      default:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_GATEWAY);
    }
  }
}
