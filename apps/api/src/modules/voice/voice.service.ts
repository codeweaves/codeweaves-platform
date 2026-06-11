import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import type { N8nStreamChunk } from '../../services/n8n-stream.interface';
import type { VoiceStreamChunk } from './interfaces/voice-stream.interface';
import { SentenceBuffer } from './utils/sentence-buffer';
import {
  type VoiceProvider,
  type STTRequest,
  type STTResponse,
  type TTSRequest,
  type TTSResponse,
  type TTSSession,
  type LanguageDetectionResponse,
  type SupportedLanguage,
  type VoiceListItem,
  VOICE_PROVIDERS,
  UnsupportedLanguageError,
  VoiceProviderError,
} from './providers/voice-provider.interface';
import { PrismaService } from '../../services/prisma.service';
import { type VoiceConfigDto, voiceConfigSchema } from '@repo/validation';

const DEFAULT_VOICE_CONFIG: VoiceConfigDto = Object.freeze(
  voiceConfigSchema.parse({}),
) as VoiceConfigDto;

/** Providers that should only be used in routing when no real provider is available */
const NON_ROUTABLE_PROVIDERS = new Set(['stub']);

/** Providers that do not support TTS */
const NO_TTS_PROVIDERS = new Set(['deepgram']);

/** Cache TTL: 60 seconds — balances freshness with DB load */
const VOICE_CONFIG_CACHE_TTL_MS = 60_000;

/** Voice catalog rarely changes — cache aggregated provider lists for 1 hour. */
const VOICE_LIST_CACHE_TTL_MS = 60 * 60 * 1000;

/** Preview audio for a (provider, voiceId, language) is deterministic — cache for 1 day. */
const VOICE_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Render a personalised preview line per language. Falls back to English when the language
 *  isn't templated, and to a generic sample when the voice name isn't known. */
function renderPreviewSample(language: SupportedLanguage, voiceName?: string): string {
  const name = voiceName?.trim();

  if (!name) {
    const generic: Partial<Record<SupportedLanguage, string>> = {
      en: 'Hello! This is a sample of my voice.',
      hi: 'नमस्ते! यह मेरी आवाज़ का एक नमूना है।',
      mr: 'नमस्कार! हे माझ्या आवाजाचे एक नमुना आहे.',
      bn: 'নমস্কার! এটি আমার কণ্ঠের একটি নমুনা।',
      ta: 'வணக்கம்! இது என் குரலின் ஒரு மாதிரி.',
      te: 'నమస్కారం! ఇది నా స్వరం యొక్క ఒక నమూనా.',
      gu: 'નમસ્તે! આ મારી અવાજનો એક નમૂનો છે.',
      kn: 'ನಮಸ್ಕಾರ! ಇದು ನನ್ನ ಧ್ವನಿಯ ಒಂದು ಮಾದರಿ.',
      ml: 'നമസ്കാരം! ഇത് എന്റെ ശബ്ദത്തിന്റെ ഒരു മാതൃകയാണ്.',
      pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਇਹ ਮੇਰੀ ਆਵਾਜ਼ ਦਾ ਇੱਕ ਨਮੂਨਾ ਹੈ।',
      or: 'ନମସ୍କାର! ଏହା ମୋ ସ୍ୱରର ଏକ ନମୁନା।',
      hinglish: 'Hello! Yeh meri awaaz ka ek sample hai.',
    };
    return generic[language] ?? generic.en!;
  }

  const personalised: Partial<Record<SupportedLanguage, string>> = {
    en: `Hello! My name is ${name}, nice to talk to you.`,
    hi: `नमस्ते! मेरा नाम ${name} है, आपसे बात करके अच्छा लगा।`,
    mr: `नमस्कार! माझं नाव ${name} आहे, तुमच्याशी बोलून आनंद झाला.`,
    bn: `নমস্কার! আমার নাম ${name}, আপনার সাথে কথা বলে ভালো লাগলো।`,
    ta: `வணக்கம்! என் பெயர் ${name}, உங்களுடன் பேசுவதில் மகிழ்ச்சி.`,
    te: `నమస్కారం! నా పేరు ${name}, మీతో మాట్లాడడం బాగుంది.`,
    gu: `નમસ્તે! મારું નામ ${name} છે, તમારી સાથે વાત કરીને આનંદ થયો.`,
    kn: `ನಮಸ್ಕಾರ! ನನ್ನ ಹೆಸರು ${name}, ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಿ ಸಂತೋಷವಾಯಿತು.`,
    ml: `നമസ്കാരം! എന്റെ പേര് ${name}, നിങ്ങളോട് സംസാരിക്കാൻ കഴിഞ്ഞത് സന്തോഷം.`,
    pa: `ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੇਰਾ ਨਾਮ ${name} ਹੈ, ਤੁਹਾਡੇ ਨਾਲ ਗੱਲ ਕਰਕੇ ਚੰਗਾ ਲੱਗਾ।`,
    or: `ନମସ୍କାର! ମୋ ନାମ ${name}, ଆପଣଙ୍କ ସହିତ କଥା ହୋଇ ଆନନ୍ଦ ହେଲା।`,
    hinglish: `Hello! Mera naam ${name} hai, aapse baat karke achha laga.`,
  };
  return personalised[language] ?? personalised.en!;
}

interface CachedVoiceConfig {
  config: VoiceConfigDto;
  expiresAt: number;
}

export interface ProviderVoiceList {
  provider: string;
  voices: VoiceListItem[];
}

interface CachedVoiceList {
  data: ProviderVoiceList[];
  expiresAt: number;
}

export interface VoicePreviewResult {
  audio: Buffer;
  audioFormat: string;
}

interface CachedVoicePreview {
  result: VoicePreviewResult;
  expiresAt: number;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly registry = new Map<string, VoiceProvider>();
  private readonly sttProviders = new Map<string, VoiceProvider>();
  private readonly ttsProviders = new Map<string, VoiceProvider>();

  private readonly INDIAN_LANGUAGES = new Set<string>([
    'hi',
    'mr',
    'bn',
    'ta',
    'te',
    'gu',
    'kn',
    'ml',
    'pa',
    'or',
    'hinglish',
  ]);

  private readonly voiceConfigCache = new Map<string, CachedVoiceConfig>();
  private voiceListCache: CachedVoiceList | null = null;
  private voiceListInflight: Promise<ProviderVoiceList[]> | null = null;
  private readonly voicePreviewCache = new Map<string, CachedVoicePreview>();

  constructor(
    @Inject(VOICE_PROVIDERS) providers: VoiceProvider[],
    private readonly prisma: PrismaService,
  ) {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  private registerProvider(provider: VoiceProvider): void {
    if (this.registry.has(provider.name)) {
      this.logger.warn(
        `Provider "${provider.name}" is already registered — overwriting`,
      );
    }
    this.registry.set(provider.name, provider);

    if (NON_ROUTABLE_PROVIDERS.has(provider.name)) {
      this.logger.log(
        `Registered voice provider: ${provider.name} (non-routable)`,
      );
      return;
    }

    // Register in STT map
    this.sttProviders.set(provider.name, provider);

    // Register in TTS map — exclude providers that don't support TTS
    if (!NO_TTS_PROVIDERS.has(provider.name)) {
      this.ttsProviders.set(provider.name, provider);
    }

    this.logger.log(`Registered voice provider: ${provider.name}`);
  }

  getProvider(name: string): VoiceProvider {
    const provider = this.registry.get(name);
    if (!provider) {
      throw new BadRequestException(`Unknown voice provider: "${name}"`);
    }
    return provider;
  }

  getRegisteredProviders(): string[] {
    return Array.from(this.registry.keys());
  }

  getProvidersInfo(): {
    name: string;
    stt: boolean;
    tts: boolean;
    languages: string[];
  }[] {
    return Array.from(this.registry.entries())
      .filter(([name]) => !NON_ROUTABLE_PROVIDERS.has(name))
      .map(([name, provider]) => ({
        name,
        stt: this.sttProviders.has(name),
        tts: this.ttsProviders.has(name),
        languages: [...provider.supportedLanguages],
      }));
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const config = await this.getVoiceConfig(request.agentId);

    // 1. Agent has an STT provider override → use it as-is, skip detection.
    if (config.sttProvider) {
      const override = this.sttProviders.get(config.sttProvider);
      if (override) {
        return this.timed(override, 'transcribe', request, `override=${config.sttProvider}`);
      }
      this.logger.warn(
        `STT override "${config.sttProvider}" not found — falling through to auto routing`,
      );
    }

    // 2. Caller passed an explicit language hint → route on language.
    if (request.languageHint) {
      const provider = this.resolveSTTProvider(config, request.languageHint);
      return this.timed(provider, 'transcribe', request, `hint=${request.languageHint}`);
    }

    // 3. Auto-detect path. Sarvam transcribes + detects language in one call. Then:
    //    - Indian language detected → Sarvam's transcript is the right answer (no second call).
    //    - English / other detected → call Deepgram fresh; Sarvam is unreliable for English
    //      even when it returns a transcript. Deepgram failure falls back to ElevenLabs,
    //      and finally to Sarvam's original transcript (so we never end with nothing).
    const sarvam = this.sttProviders.get('sarvam');
    if (!sarvam) {
      // No Sarvam at all — fall back to default-language routing.
      const fallback = this.resolveSTTProvider(config, config.defaultLanguage ?? 'en');
      return this.timed(fallback, 'transcribe', request, 'no-sarvam-fallback');
    }

    this.logger.log('No language hint — Sarvam detect + transcribe (step 1)');
    const sarvamResult = await this.timed(sarvam, 'transcribe', request, 'auto-detect-step-1');

    if (this.INDIAN_LANGUAGES.has(sarvamResult.detectedLanguage)) {
      // Sarvam is the best choice for Indian languages — accept its result (even if empty,
      // no other provider does Indian better).
      return sarvamResult;
    }

    // English / other language — Deepgram is the reliable transcriber.
    const detectedLang = sarvamResult.detectedLanguage;
    const deepgram = this.sttProviders.get('deepgram');
    if (deepgram) {
      try {
        return await this.timed(deepgram, 'transcribe', { ...request, languageHint: detectedLang }, `english-step-2 (lang=${detectedLang})`);
      } catch (error) {
        this.logger.warn(
          `Deepgram failed for ${detectedLang}: ${error instanceof Error ? error.message : 'unknown'} — trying fallback chain`,
        );
      }
    }

    // Deepgram unavailable or threw — try ElevenLabs scribe_v2 (also supports English).
    const elevenlabs = this.sttProviders.get('elevenlabs');
    if (elevenlabs) {
      try {
        return await this.timed(elevenlabs, 'transcribe', { ...request, languageHint: detectedLang }, `english-fallback-elevenlabs`);
      } catch (error) {
        this.logger.warn(
          `ElevenLabs also failed: ${error instanceof Error ? error.message : 'unknown'} — using Sarvam's auto-detect transcript`,
        );
      }
    }

    return sarvamResult;
  }

  /** Wraps a provider call with consistent latency logging. Keeps transcribe() readable. */
  private async timed(
    provider: VoiceProvider,
    op: 'transcribe',
    request: STTRequest,
    note: string,
  ): Promise<STTResponse> {
    const startTime = Date.now();
    const result = await provider[op](request);
    const latencyMs = Date.now() - startTime;
    this.logger.log(
      `STT ${op}: provider=${provider.name}, language=${result.detectedLanguage}, latency=${latencyMs}ms (${note})`,
    );
    return result;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveTTSProvider(config, request.language);
    const hasOverride = !!config.ttsProvider;
    this.logger.log(
      `TTS routing: language=${request.language}, provider=${provider.name}, override=${hasOverride}`,
    );

    // Enrich the caller's request with the agent's saved voice config so the user-selected
    // voice (and speed) are honoured by every code path that calls synthesize() — including
    // the legacy non-streaming voiceConversation flow which never sets voiceId itself.
    // Caller-supplied values win (e.g., the public /synthesize endpoint may override).
    const enrichedRequest: TTSRequest = {
      ...request,
      voiceId: request.voiceId ?? config.ttsVoiceId,
      speed: request.speed ?? config.ttsSpeed,
    };

    const startTime = Date.now();
    try {
      const result = await provider.synthesize(enrichedRequest);
      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `TTS completed: provider=${provider.name}, latency=${latencyMs}ms`,
      );
      return result;
    } catch (error) {
      if (
        error instanceof UnsupportedLanguageError ||
        error instanceof VoiceProviderError
      ) {
        return this.ttsFallback(enrichedRequest, provider.name, error);
      }
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async detectLanguage(audio: Buffer, audioFormat: string, agentId?: string): Promise<LanguageDetectionResponse> {
    // Route to Sarvam by default — best Indian language detection with 'unknown' language_code
    const sarvam = this.registry.get('sarvam');
    if (sarvam) {
      this.logger.log('Language detection: routing to sarvam (default)');
      return sarvam.detectLanguage(audio, audioFormat);
    }

    // Fallback: use first available provider
    const firstProvider = this.registry.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No voice providers available');
    }
    this.logger.log(
      `Language detection: routing to ${firstProvider.name} (fallback)`,
    );
    return firstProvider.detectLanguage(audio, audioFormat);
  }

  /**
   * Streams LLM tokens → sentence-bounded TTS audio chunks.
   *
   * PARALLEL TTS: Each sentence's TTS call is kicked off as soon as its
   * boundary is detected — we do NOT wait for the previous sentence's TTS to
   * complete. Audio chunks are still yielded IN ORDER (index 0, 1, 2, ...) so
   * playback is correct. The key win: total time ≈ max(TTS latencies), not
   * sum. On a typical 3-sentence response with ~2.5s TTS each, this is
   * ~5s faster.
   *
   * Why not await each TTS? Previously the outer `for await` loop would
   * BLOCK on each TTS call via `yield*`, which back-pressured the LLM token
   * stream: the next token couldn't be consumed until the current sentence's
   * TTS returned. That serialization was adding 5-8s of latency on top of
   * real inference time.
   */
  async *streamingTTS(
    tokenStream: AsyncGenerator<N8nStreamChunk>,
    language: string,
    agentId: string,
    config?: VoiceConfigDto,
  ): AsyncGenerator<VoiceStreamChunk> {
    const resolvedConfig = config ?? await this.getVoiceConfig(agentId);
    const provider = this.resolveTTSProvider(resolvedConfig, language as SupportedLanguage);
    const lang = language as SupportedLanguage;
    const useStreaming = resolvedConfig.ttsStreaming === true;

    // Pattern A — persistent WS session (one WS for the whole voice turn).
    // Pipecat/LiveKit do this for Sarvam: avoids the ~150-300ms WS handshake
    // gap between sentences. Disabled for EL: their `/stream-input` endpoint
    // is unstable mid-stream; the proper fix is the `/multi-stream-input`
    // protocol which is a separate refactor.
    const providerStreamingDisabled = provider.name === 'elevenlabs';
    const sessionEligible =
      useStreaming &&
      !providerStreamingDisabled &&
      typeof provider.openSynthesisSession === 'function';

    if (sessionEligible) {
      yield* this.streamingTTSWithSession(
        tokenStream,
        lang,
        agentId,
        resolvedConfig,
        provider,
      );
      return;
    }

    // Pattern B — per-sentence parallel TTS (legacy / fallback). Used when
    // the provider doesn't expose a session, when ttsStreaming is off, or
    // when WS streaming is force-disabled for the provider (EL).
    yield* this.streamingTTSPerSentence(
      tokenStream,
      lang,
      agentId,
      resolvedConfig,
      provider,
    );
  }

  /**
   * Persistent-WS-session pipeline. One WS open for the entire voice turn;
   * sentences are synthesized sequentially on that single connection. This
   * eliminates the per-sentence WS handshake gap (~150-300ms) that's audible
   * after short sentences like "Certainly." Returning the audible win is the
   * whole point of moving to session-based TTS.
   *
   * Sentence ordering: LLM tokens stream in continuously, but each sentence's
   * synthesize() must finish (event_type=final) before the next is sent. This
   * is structurally serial — Sarvam's WS is single-context. The user still
   * gets continuous audio because Sarvam synthesises ~3x real-time, so by the
   * time the user finishes hearing sentence N, sentence N+1 has already
   * been synthesised and is queued at the network layer.
   */
  private async *streamingTTSWithSession(
    tokenStream: AsyncGenerator<N8nStreamChunk>,
    lang: SupportedLanguage,
    agentId: string,
    config: VoiceConfigDto,
    provider: VoiceProvider,
  ): AsyncGenerator<VoiceStreamChunk> {
    // openSynthesisSession is guaranteed by the caller's check, but TS can't
    // narrow that across the method boundary — fall through to per-sentence
    // mode defensively if the provider lost the capability between checks.
    if (typeof provider.openSynthesisSession !== 'function') {
      yield* this.streamingTTSPerSentence(tokenStream, lang, agentId, config, provider);
      return;
    }

    const sentenceBuffer = new SentenceBuffer();
    let fullText = '';
    let sentenceIndex = 0;
    let successCount = 0;
    let session: TTSSession | null = null;

    try {
      session = await provider.openSynthesisSession({
        language: lang,
        agentId,
        voiceId: config.ttsVoiceId,
        speed: config.ttsSpeed,
      });

      // Tokens stream in; we synthesise each sentence sequentially on the
      // session as it forms. The session itself manages the WS lifecycle.
      const renderSentence = async function* (
        this: VoiceService,
        sentence: string,
      ): AsyncGenerator<VoiceStreamChunk> {
        const idx = sentenceIndex++;
        const ttsStart = Date.now();
        let chunkCount = 0;
        let totalBytes = 0;
        let firstChunkLatencyMs: number | null = null;
        let lastAudioFormat = 'audio/pcm; rate=24000';

        try {
          for await (const chunk of session!.synthesize(sentence)) {
            if (firstChunkLatencyMs === null) {
              firstChunkLatencyMs = chunk.latencyMs;
            }
            totalBytes += chunk.audio.length;
            lastAudioFormat = chunk.audioFormat;

            yield {
              type: 'audio',
              sentenceIndex: idx,
              subChunkIndex: chunkCount,
              isFinalChunk: false,
              text: chunkCount === 0 ? sentence : '',
              audio: chunk.audio.toString('base64'),
              audioFormat: chunk.audioFormat,
              audioDurationMs: null,
              ttsLatencyMs: chunk.latencyMs,
              ttsProtocol: 'websocket',
              ...(chunkCount === 0
                ? { wsFirstChunkLatencyMs: firstChunkLatencyMs }
                : {}),
            };
            chunkCount += 1;
          }
        } catch (err) {
          // Mid-sentence session failure: if any chunks were yielded, accept
          // truncation (don't fall back — re-synthesising the full sentence
          // would double-play). If NO chunks yielded, fall back to batch HTTP.
          if (chunkCount > 0) {
            this.logger.warn(
              `Session synthesise mid-stream failure for sentence ${idx} after ${chunkCount} chunks: ${err instanceof Error ? err.message : 'unknown'}`,
            );
            // emit the per-sentence final marker so analytics settle
            yield {
              type: 'audio',
              sentenceIndex: idx,
              subChunkIndex: chunkCount,
              isFinalChunk: true,
              text: '',
              audio: '',
              audioFormat: lastAudioFormat,
              audioDurationMs: null,
              ttsLatencyMs: Date.now() - ttsStart,
              ttsProtocol: 'websocket',
              wsChunkCount: chunkCount,
              wsTotalBytes: totalBytes,
            };
            successCount++;
            return;
          }
          // Zero chunks emitted — fall back to batch HTTP for this sentence.
          this.logger.warn(
            `Session synthesise failed before any chunks for sentence ${idx}: ${err instanceof Error ? err.message : 'unknown'} — falling back to batch`,
          );
          try {
            const batchResult = await provider.synthesize({
              text: sentence,
              language: lang,
              agentId,
              voiceId: config.ttsVoiceId,
              speed: config.ttsSpeed,
            });
            yield {
              type: 'audio',
              sentenceIndex: idx,
              subChunkIndex: 0,
              isFinalChunk: true,
              text: sentence,
              audio: batchResult.audio.toString('base64'),
              audioFormat: batchResult.audioFormat,
              audioDurationMs: batchResult.durationMs ?? null,
              ttsLatencyMs: batchResult.latencyMs,
              ttsProtocol: 'http',
            };
            successCount++;
            return;
          } catch (batchErr) {
            this.logger.error(
              `Batch fallback also failed for sentence ${idx}: ${batchErr instanceof Error ? batchErr.message : 'unknown'}`,
            );
            yield {
              type: 'error',
              errorCode: 'TTS_ALL_PROVIDERS_FAILED',
              message: 'Voice synthesis unavailable for this sentence',
              sentenceIndex: idx,
            };
            return;
          }
        }

        // Sentence completed cleanly — emit the per-sentence final marker.
        yield {
          type: 'audio',
          sentenceIndex: idx,
          subChunkIndex: chunkCount,
          isFinalChunk: true,
          text: '',
          audio: '',
          audioFormat: lastAudioFormat,
          audioDurationMs: null,
          ttsLatencyMs: Date.now() - ttsStart,
          ttsProtocol: 'websocket',
          wsChunkCount: chunkCount,
          wsTotalBytes: totalBytes,
        };
        successCount++;
      }.bind(this);

      // Drive the LLM token stream → sentence buffer → session.synthesize.
      for await (const chunk of tokenStream) {
        if (chunk.type === 'item' && chunk.content) {
          fullText += chunk.content;
          const sentences = sentenceBuffer.addToken(chunk.content);
          for (const sentence of sentences) {
            for await (const c of renderSentence(sentence)) {
              yield c.type === 'audio' ? { ...c, ttsProvider: provider.name } : c;
            }
          }
        }
      }
      // Tail (partial sentence without terminator)
      const remaining = sentenceBuffer.flush();
      if (remaining) {
        for await (const c of renderSentence(remaining)) {
          yield c.type === 'audio' ? { ...c, ttsProvider: provider.name } : c;
        }
      }
    } finally {
      if (session) {
        try {
          await session.close();
        } catch {
          // ignore — session is being torn down anyway
        }
      }
    }

    yield { type: 'end', fullText, totalSentences: successCount };
  }

  /**
   * Per-sentence parallel pipeline (legacy / fallback). Opens a new WS or
   * fires a new batch HTTP request per sentence. Sentences synthesize in
   * parallel, yields stay in order. Used when:
   *   - provider doesn't implement `openSynthesisSession` (EL today)
   *   - ttsStreaming is OFF (batch HTTP path)
   *   - WS streaming is force-disabled for the provider
   */
  private async *streamingTTSPerSentence(
    tokenStream: AsyncGenerator<N8nStreamChunk>,
    lang: SupportedLanguage,
    agentId: string,
    config: VoiceConfigDto,
    provider: VoiceProvider,
  ): AsyncGenerator<VoiceStreamChunk> {
    const sentenceBuffer = new SentenceBuffer();
    const ttsPromises: Promise<VoiceStreamChunk[]>[] = [];
    let fullText = '';

    const wake: { fn: (() => void) | null } = { fn: null };
    const waitForNewPromise = () =>
      new Promise<void>((resolve) => {
        wake.fn = resolve;
      });
    const notifyYielder = () => {
      if (wake.fn) {
        wake.fn();
        wake.fn = null;
      }
    };

    let llmConsumerDone = false;
    let llmConsumerError: unknown = null;

    const llmConsumer = (async () => {
      try {
        for await (const chunk of tokenStream) {
          if (chunk.type === 'item' && chunk.content) {
            fullText += chunk.content;
            const sentences = sentenceBuffer.addToken(chunk.content);
            for (const sentence of sentences) {
              ttsPromises.push(
                this.synthesizeSentenceToChunks(
                  sentence,
                  lang,
                  agentId,
                  config,
                  provider,
                  ttsPromises.length,
                ),
              );
              notifyYielder();
            }
          }
        }
        const remaining = sentenceBuffer.flush();
        if (remaining) {
          ttsPromises.push(
            this.synthesizeSentenceToChunks(
              remaining,
              lang,
              agentId,
              config,
              provider,
              ttsPromises.length,
            ),
          );
          notifyYielder();
        }
      } catch (err) {
        llmConsumerError = err;
      } finally {
        llmConsumerDone = true;
        notifyYielder();
      }
    })();

    let yielded = 0;
    let successCount = 0;
    while (true) {
      if (yielded < ttsPromises.length) {
        const chunks = await ttsPromises[yielded]!;
        yielded++;
        let sentenceSucceeded = false;
        for (const c of chunks) {
          if (c.type === 'audio' && c.isFinalChunk) sentenceSucceeded = true;
          yield c;
        }
        if (sentenceSucceeded) successCount++;
      } else if (llmConsumerDone) {
        break;
      } else {
        await waitForNewPromise();
      }
    }

    await llmConsumer;
    if (llmConsumerError) throw llmConsumerError;

    yield { type: 'end', fullText, totalSentences: successCount };
  }

  /**
   * Adapter: collect a `synthesizeSentenceWithFallback` generator's yields
   * into an array so the parent can run it as a Promise (for parallel
   * scheduling). The existing generator yields 0-1 chunks per call.
   */
  private async synthesizeSentenceToChunks(
    sentence: string,
    language: SupportedLanguage,
    agentId: string,
    config: VoiceConfigDto,
    primaryProvider: VoiceProvider,
    sentenceIndex: number,
  ): Promise<VoiceStreamChunk[]> {
    const out: VoiceStreamChunk[] = [];
    for await (const chunk of this.synthesizeSentenceWithFallback(
      sentence,
      language,
      agentId,
      config,
      primaryProvider,
      sentenceIndex,
    )) {
      out.push(chunk);
    }
    return out;
  }

  private async *synthesizeSentenceWithFallback(
    sentence: string,
    language: SupportedLanguage,
    agentId: string,
    config: VoiceConfigDto,
    primaryProvider: VoiceProvider,
    sentenceIndex: number,
  ): AsyncGenerator<VoiceStreamChunk, boolean> {
    const request: TTSRequest = {
      text: sentence,
      language,
      agentId,
      voiceId: config.ttsVoiceId,
      speed: config.ttsSpeed,
    };

    // Try primary provider. When `voiceConfig.ttsStreaming` is true AND the
    // provider implements `synthesizeStream()`, we forward each WebSocket
    // chunk to the client as its own `audio` event (with subChunkIndex). This
    // is what unlocks the real perceptual win: first audio starts playing in
    // ~600ms instead of ~1600ms because we don't wait for the full sentence
    // to render before sending bytes to the client.
    //
    // Otherwise (or on fallback) we use batch HTTP which emits one chunk per
    // sentence with subChunkIndex=0, isFinalChunk=true.
    // Track whether the primary path emitted any audio to the client. Hoisted
    // above the try/catch so the catch block can branch on it (see double-play
    // note below).
    let primaryFirstYielded = false;
    try {
      const useStreaming = config.ttsStreaming === true;
      for await (const chunk of this.synthesizeWithProvider(
        request,
        primaryProvider,
        sentence,
        sentenceIndex,
        useStreaming,
      )) {
        yield chunk.type === 'audio' ? { ...chunk, ttsProvider: primaryProvider.name } : chunk;
        primaryFirstYielded = true;
      }
      return primaryFirstYielded;
    } catch (err) {
      // CRITICAL: if the primary already yielded any chunks before failing,
      // the client has ALREADY queued / played that partial audio. Falling
      // back to another provider would re-synthesise the FULL sentence and
      // the client would play it on top — user hears the same sentence
      // twice (the EL→Sarvam double-play bug). Accept the truncation and
      // skip the fallback; the user gets a slightly cut-off sentence but
      // not a duplicate one.
      if (primaryFirstYielded) {
        this.logger.warn(
          `Primary TTS ${primaryProvider.name} mid-stream failure for sentence ${sentenceIndex} after partial audio sent — skipping fallback to avoid double-play. Error: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        return true;
      }

      this.logger.warn(
        `Primary TTS ${primaryProvider.name} failed for sentence ${sentenceIndex} (streaming=${config.ttsStreaming === true}): ${err instanceof Error ? err.message : 'unknown'} — trying fallback providers`,
      );

      // Try fallback providers ONLY when nothing was emitted to the client.
      // ALWAYS use batch HTTP for fallback — if the streaming path failed
      // on the primary, the goal is "get audio out at all", not "fast".
      const fallbackOrder = ['elevenlabs', 'sarvam'];
      for (const providerName of fallbackOrder) {
        if (providerName === primaryProvider.name) continue;
        const fallbackProvider = this.ttsProviders.get(providerName);
        if (!fallbackProvider) continue;

        try {
          this.logger.warn(
            `Streaming TTS fallback: ${primaryProvider.name} → ${providerName} for sentence ${sentenceIndex}`,
          );
          let firstYielded = false;
          for await (const chunk of this.synthesizeWithProvider(
            request,
            fallbackProvider,
            sentence,
            sentenceIndex,
            false, // batch only for fallback
          )) {
            yield chunk.type === 'audio' ? { ...chunk, ttsProvider: fallbackProvider.name } : chunk;
            firstYielded = true;
          }
          if (firstYielded) return true;
        } catch {
          continue;
        }
      }

      // All providers failed — yield error chunk, continue stream
      this.logger.error(
        `All TTS providers failed for sentence ${sentenceIndex}: "${sentence.substring(0, 50)}..."`,
      );
      yield {
        type: 'error',
        errorCode: 'TTS_ALL_PROVIDERS_FAILED',
        message: 'Voice synthesis unavailable for this sentence',
        sentenceIndex,
      };
      return false;
    }
  }

  /**
   * Synthesise one sentence via either WebSocket streaming (yields multiple
   * audio chunks as the provider renders) or batch HTTP (yields exactly one
   * audio chunk). Both modes emit `VoiceAudioChunk`s with the same shape so
   * downstream code is transport-agnostic.
   *
   * Streaming details:
   *   - Provider yields raw PCM chunks (ElevenLabs pcm_24000, Sarvam wav with
   *     header stripped). Each chunk carries `audioFormat: 'audio/pcm;
   *     rate=<N>'` so the client knows the sample rate without inspection.
   *   - We forward each provider chunk as its own client `audio` event with
   *     `subChunkIndex` 0..N-1 and `isFinalChunk` true on the last one.
   *   - The first chunk carries `wsFirstChunkLatencyMs` (the perceptual TTFA);
   *     the final chunk carries `wsChunkCount` + `wsTotalBytes` (analytics).
   *   - `ttsLatencyMs` on each chunk = time from request start to THAT chunk.
   */
  private async *synthesizeWithProvider(
    request: TTSRequest,
    provider: VoiceProvider,
    sentence: string,
    sentenceIndex: number,
    useStreaming: boolean,
  ): AsyncGenerator<VoiceStreamChunk> {
    const ttsStart = Date.now();

    // ElevenLabs' WebSocket stream-input endpoint drops connections
    // mid-stream with close code 1006 (no proper close frame) — a known
    // instability with open issues against livekit/agents and pipecat. The
    // result for users is partial / spliced audio: first sentence cut to a
    // fraction of a word, second sentence cuts in unexpectedly.
    //
    // Until ElevenLabs ships a more reliable streaming endpoint (their newer
    // multi-stream-input is an option later), force EL down the batch HTTP
    // path even when ttsStreaming is enabled at the agent level. The
    // outer sentence-level streaming still works (one HTTP call per sentence,
    // chunks delivered as each sentence completes) — same behaviour as
    // develop. Only WITHIN-sentence WS streaming is disabled for EL.
    //
    // The agent editor UI also hides the ttsStreaming toggle when EL is
    // selected; this gate is defense-in-depth for agents that already had
    // the flag enabled before the UI fix lands.
    //
    // Sarvam WS is stable and continues to use the streaming path normally.
    const providerStreamingDisabled = provider.name === 'elevenlabs';
    const effectiveStreaming = useStreaming && !providerStreamingDisabled;

    if (effectiveStreaming && typeof provider.synthesizeStream === 'function') {
      // Yield each chunk to the client AS IT ARRIVES — no look-ahead buffering.
      // Pattern mirrors pipecat's Sarvam TTS implementation (reactive, not
      // predictive) — see reference-server.pipecat.ai/.../sarvam/tts.html. The
      // previous look-ahead held chunk N hostage until chunk N+1 arrived to
      // know which one was "final"; that added ~150-300ms to the perceived
      // time-to-first-audio for nothing. Clients don't actually need
      // `isFinalChunk` to play audio — they consume each chunk independently
      // — so we emit a separate synthetic "audio-final" marker after the loop
      // ends. Per-sentence WS totals also land on that marker chunk.
      let firstChunkLatencyMs: number | null = null;
      let chunkCount = 0;
      let totalBytes = 0;
      // Track the provider's audioFormat from the last chunk so the synthetic
      // final-marker can mirror it. Hard-coding a sample rate here is a footgun
      // — providers differ (Sarvam bulbul:v3 = 24000, ElevenLabs PCM = 24000,
      // Sarvam bulbul:v2 = 22050).
      let lastAudioFormat = 'audio/pcm; rate=24000';

      try {
        for await (const chunk of provider.synthesizeStream(request)) {
          if (firstChunkLatencyMs === null) {
            firstChunkLatencyMs = chunk.latencyMs;
          }
          totalBytes += chunk.audio.length;
          lastAudioFormat = chunk.audioFormat;

          const out: VoiceStreamChunk = {
            type: 'audio',
            sentenceIndex,
            subChunkIndex: chunkCount,
            // We don't know if this is the last chunk yet — only the provider
            // does. We emit a separate final-marker chunk after the stream
            // ends to settle per-sentence totals.
            isFinalChunk: false,
            text: chunkCount === 0 ? sentence : '',
            audio: chunk.audio.toString('base64'),
            audioFormat: chunk.audioFormat,
            audioDurationMs: null,
            ttsLatencyMs: chunk.latencyMs,
            ttsProtocol: 'websocket',
            ...(chunkCount === 0
              ? { wsFirstChunkLatencyMs: firstChunkLatencyMs }
              : {}),
          };
          chunkCount += 1;
          yield out;
        }

        // Final marker — empty audio, signals "this sentence is done" so the
        // outer voice controller can stamp per-sentence aggregate metrics
        // (totalSentences increments, wsChunkCount + wsTotalBytes attach).
        // Empty-audio chunks are a no-op on the client's playback queue.
        yield {
          type: 'audio',
          sentenceIndex,
          subChunkIndex: chunkCount,
          isFinalChunk: true,
          text: '',
          audio: '',
          audioFormat: lastAudioFormat,
          audioDurationMs: null,
          ttsLatencyMs: Date.now() - ttsStart,
          ttsProtocol: 'websocket',
          wsChunkCount: chunkCount,
          wsTotalBytes: totalBytes,
        };
      } catch (err) {
        // Re-throw so the outer try/catch falls back to batch on another
        // provider (only if no chunks were yielded — see the double-play
        // guard in synthesizeSentenceWithFallback). Log first so ops can
        // spot WS failures.
        this.logger.warn(
          `WS synthesizeStream on ${provider.name} threw after ${chunkCount} chunks: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        throw err;
      }
      return;
    }

    // Batch HTTP path (legacy + fallback). Single chunk per sentence.
    const ttsResult = await provider.synthesize(request);
    const ttsLatencyMs = Date.now() - ttsStart;
    yield {
      type: 'audio',
      sentenceIndex,
      subChunkIndex: 0,
      isFinalChunk: true,
      text: sentence,
      audio: ttsResult.audio.toString('base64'),
      audioFormat: ttsResult.audioFormat,
      audioDurationMs: ttsResult.durationMs ?? null,
      ttsLatencyMs,
      ttsProtocol: 'http',
    };
  }

  private resolveSTTProvider(
    config: VoiceConfigDto,
    language: string,
  ): VoiceProvider {
    // Priority 1: Agent override
    if (config.sttProvider) {
      const override = this.sttProviders.get(config.sttProvider);
      if (override) return override;
      this.logger.warn(
        `STT override provider "${config.sttProvider}" not found, falling back to language-based routing`,
      );
    }

    // Priority 2: Language-based routing
    if (this.INDIAN_LANGUAGES.has(language)) {
      const sarvam = this.sttProviders.get('sarvam');
      if (sarvam) return sarvam;
    }

    // Priority 3: Default → Deepgram
    const deepgram = this.sttProviders.get('deepgram');
    if (deepgram) return deepgram;

    // Last resort: first available STT provider
    const firstProvider = this.sttProviders.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No STT providers available');
    }
    return firstProvider;
  }

  private resolveTTSProvider(
    config: VoiceConfigDto,
    language: SupportedLanguage,
  ): VoiceProvider {
    // Priority 1: Agent override
    if (config.ttsProvider) {
      const override = this.ttsProviders.get(config.ttsProvider);
      if (override) return override;
      this.logger.warn(
        `TTS override provider "${config.ttsProvider}" not found, falling back to language-based routing`,
      );
    }

    // Priority 2: Language-based routing
    if (this.INDIAN_LANGUAGES.has(language)) {
      const sarvam = this.ttsProviders.get('sarvam');
      if (sarvam) return sarvam;
    }

    // Priority 3: Default → ElevenLabs
    const elevenlabs = this.ttsProviders.get('elevenlabs');
    if (elevenlabs) return elevenlabs;

    // Last resort: first available TTS provider
    const firstProvider = this.ttsProviders.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No TTS providers available');
    }
    return firstProvider;
  }

  private async ttsFallback(
    request: TTSRequest,
    failedProviderName: string,
    originalError: Error,
  ): Promise<TTSResponse> {
    const fallbackOrder = ['sarvam', 'elevenlabs'];

    for (const providerName of fallbackOrder) {
      if (providerName === failedProviderName) continue;
      const provider = this.ttsProviders.get(providerName);
      if (!provider) continue;

      try {
        this.logger.warn(
          `TTS fallback: ${failedProviderName} → ${providerName}, reason: ${originalError.message}`,
        );
        return await provider.synthesize(request);
      } catch (e) {
        if (
          e instanceof UnsupportedLanguageError ||
          e instanceof VoiceProviderError
        ) {
          continue;
        }
        throw e;
      }
    }

    throw new BadGatewayException(
      `No TTS provider supports language: ${request.language}`,
    );
  }

  async getVoiceConfig(agentId: string): Promise<VoiceConfigDto> {
    const now = Date.now();
    const cached = this.voiceConfigCache.get(agentId);
    if (cached && cached.expiresAt > now) return cached.config;

    try {
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: { voiceEnabled: true, voiceConfig: true },
      });

      if (!agent || !agent.voiceEnabled || !agent.voiceConfig) {
        this.cacheConfig(agentId, DEFAULT_VOICE_CONFIG);
        return DEFAULT_VOICE_CONFIG;
      }

      const config = voiceConfigSchema.parse(agent.voiceConfig);
      this.cacheConfig(agentId, config);
      return config;
    } catch (error) {
      this.logger.warn(
        `Failed to load voice config for agent ${agentId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // Don't cache transient errors — let next request retry
      return DEFAULT_VOICE_CONFIG;
    }
  }

  private cacheConfig(agentId: string, config: VoiceConfigDto): void {
    this.voiceConfigCache.set(agentId, {
      config,
      expiresAt: Date.now() + VOICE_CONFIG_CACHE_TTL_MS,
    });
  }

  clearVoiceConfigCache(): void {
    this.voiceConfigCache.clear();
  }

  async listAllVoices(): Promise<ProviderVoiceList[]> {
    const now = Date.now();
    if (this.voiceListCache && this.voiceListCache.expiresAt > now) {
      return this.voiceListCache.data;
    }
    if (this.voiceListInflight) return this.voiceListInflight;

    this.voiceListInflight = this.fetchAllVoices().finally(() => {
      this.voiceListInflight = null;
    });
    return this.voiceListInflight;
  }

  private async fetchAllVoices(): Promise<ProviderVoiceList[]> {
    const tasks = Array.from(this.ttsProviders.entries())
      .filter(([, provider]) => typeof provider.listVoices === 'function')
      .map(async ([name, provider]): Promise<ProviderVoiceList> => {
        try {
          const voices = await provider.listVoices!();
          return { provider: name, voices };
        } catch (error) {
          this.logger.warn(
            `Failed to list voices from ${name}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          return { provider: name, voices: [] };
        }
      });

    const results = await Promise.all(tasks);
    this.voiceListCache = {
      data: results,
      expiresAt: Date.now() + VOICE_LIST_CACHE_TTL_MS,
    };
    return results;
  }

  clearVoiceListCache(): void {
    this.voiceListCache = null;
  }

  async previewVoice(
    provider: string,
    voiceId: string,
    language?: SupportedLanguage,
  ): Promise<VoicePreviewResult> {
    const lang: SupportedLanguage = language ?? 'en';
    const cacheKey = `${provider}:${voiceId}:${lang}`;

    const now = Date.now();
    const cached = this.voicePreviewCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.result;

    const ttsProvider = this.ttsProviders.get(provider);
    if (!ttsProvider) {
      throw new BadRequestException(`Unknown TTS provider: "${provider}"`);
    }

    // Look up the voice's display name from the cached catalog so the preview can introduce
    // itself ("Hello, my name is X..."). Falls back to a generic line when not in the catalog.
    let voiceName: string | undefined;
    try {
      const catalog = await this.listAllVoices();
      voiceName = catalog
        .find((p) => p.provider === provider)
        ?.voices.find((v) => v.id === voiceId)
        ?.name;
    } catch {
      // listAllVoices already swallows individual provider errors; treat unknown failures
      // as "no name available" rather than blocking the preview.
    }

    const sample = renderPreviewSample(lang, voiceName);

    // Provider impls don't use agentId; placeholder satisfies the typed TTSRequest contract
    // without going through the agent-config lookup path used by VoiceService.synthesize().
    // Prefer synthesizePreview() — it returns WAV (no MP3 priming silence, no first-word
    // clipping). Fall back to synthesize() (MP3) if a provider doesn't implement it; the
    // frontend's findLeadingSilence heuristic will still mostly mask the clipping.
    const ttsRequest: TTSRequest = {
      text: sample,
      language: lang,
      voiceId,
      speed: 1.0,
      agentId: '__preview__',
    };
    const ttsResult = ttsProvider.synthesizePreview
      ? await ttsProvider.synthesizePreview(ttsRequest)
      : await ttsProvider.synthesize(ttsRequest);

    const result: VoicePreviewResult = {
      audio: ttsResult.audio,
      audioFormat: ttsResult.audioFormat,
    };
    this.voicePreviewCache.set(cacheKey, {
      result,
      expiresAt: now + VOICE_PREVIEW_CACHE_TTL_MS,
    });
    return result;
  }

  clearVoicePreviewCache(): void {
    this.voicePreviewCache.clear();
  }
}
