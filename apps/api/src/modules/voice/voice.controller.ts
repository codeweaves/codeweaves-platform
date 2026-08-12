import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { AppLogger } from '../../common/logger/app-logger';
import { VoiceEventLogger } from '../../common/events/voice.logger';
import { Public } from '../../decorators/public.decorator';
import { VoiceService } from './voice.service';
import { ChatService } from '../../services/chat.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MessageMetricsService } from '../../services/message-metrics.service';
import { detectFallback } from '../../utils/fallback-detection';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { AgentsService } from '../../services/agents.service';
import { PrismaService } from '../../services/prisma.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { DirectChatService } from '../ai/direct-chat.service';
import type { DirectChatResult } from '../ai/interfaces/direct-chat.interfaces';
import { directChatToN8nStream } from '../ai/adapters/voice-token-stream.adapter';
import { resolveRoutingMode } from '@repo/validation';
import type { N8nStreamChunk } from '../../services/n8n-stream.interface';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import {
  voiceConversationSchema,
  transcribeSchema,
  synthesizeSchema,
  voiceErrorCodes,
  type VoiceConversationDto,
  type VoiceConfigDto,
  type TranscribeDto,
  type SynthesizeDto,
} from '@repo/validation';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
  type SupportedLanguage,
  type STTResponse,
} from './providers/voice-provider.interface';

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@ApiTags('Voice')
@Public()
@Controller('public/voice')
export class VoiceController {
  private readonly log = new AppLogger(VoiceController.name);

  constructor(
    private readonly voiceService: VoiceService,
    private readonly chatService: ChatService,
    private readonly n8nStreamingService: N8nStreamingService,
    private readonly agentsService: AgentsService,
    private readonly prisma: PrismaService,
    private readonly messageRateLimitService: MessageRateLimitService,
    private readonly directChatService: DirectChatService,
    private readonly messageMetricsService: MessageMetricsService,
    private readonly voiceLog: VoiceEventLogger,
    private readonly crypto: CryptoService,
  ) {}

  @Post('conversation')
  @ApiOperation({ summary: 'Full voice conversation: audio in, audio + text out' })
  @ApiResponse({ status: 200, description: 'Voice conversation result' })
  @ApiResponse({ status: 400, description: 'Invalid input or missing audio file' })
  @ApiResponse({ status: 422, description: 'Unsupported language or STT failure' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  @ApiResponse({ status: 502, description: 'Voice provider unavailable' })
  @ApiResponse({ status: 504, description: 'Voice provider timeout' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async voiceConversation(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(voiceConversationSchema)) dto: VoiceConversationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audioValidationError = this.validateAudioFile(audioFile);
    if (audioValidationError) {
      res.status(HttpStatus.BAD_REQUEST);
      return audioValidationError;
    }

    // Resolve publicId → internal UUID (widget sends publicId, not UUID)
    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;
    // S1 (DPDP): store only a keyed hash of the visitor IP — raw IP never
    // travels past this line (loopback → undefined; backfilled later).
    const visitorIp = this.crypto.hashVisitorIp(
      ChatService.extractVisitorIp(req),
    );

    this.log.debug('voiceConversation', 'conversation received', {
      agentId: resolvedAgentId,
      sessionId: dto.sessionId,
      audioMime: audioFile.mimetype,
      audioBytes: audioFile.buffer.length,
      languageHint: dto.languageHint,
    });
    // VOICE channel event: an inbound voice conversation was accepted for this
    // agent. Fire-and-forget (logger voids internally).
    this.voiceLog.logConversationReceived({
      agentId: resolvedAgentId,
      sessionId: dto.sessionId,
      visitorId: visitorIp,
      metadata: {
        audioMime: audioFile.mimetype,
        audioBytes: audioFile.buffer.length,
        languageHint: dto.languageHint,
      },
    });

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const clientIp = this.messageRateLimitService.getClientIp(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
      clientIp,
    );
    if (!rateLimitResult.allowed) {
      this.log.warn('voiceConversation', 'rate limited', {
        agentId: resolvedAgentId,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      });
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    const startTime = Date.now();

    // Step 1: STT
    const sttStart = Date.now();
    let sttResult;
    try {
      sttResult = await this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: resolvedAgentId,
        sessionId: dto.sessionId,
      });
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error);
      this.log.error('voiceConversation', 'STT failed', error, {
        agentId: resolvedAgentId,
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
      });
      this.voiceLog.logSttFailed({
        agentId: resolvedAgentId,
        sessionId: dto.sessionId,
        visitorId: visitorIp,
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        errorCode,
        error,
      });
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.languageHint ?? 'unknown',
        agentId: resolvedAgentId,
        operation: 'stt',
        errorType: 'stt_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Speech recognition failed',
      };
    }
    const sttLatencyMs = Date.now() - sttStart;

    if (!sttResult.transcript.trim()) {
      // STT couldn't extract clear speech. Could be noisy audio, mumbled input, or a
      // too-short recording — we don't differentiate; one generic message keeps copy simple.
      this.log.warn('voiceConversation', 'no speech detected in audio', {
        agentId: resolvedAgentId,
        detectedLanguage: sttResult.detectedLanguage,
      });
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return {
        error: true,
        errorCode: voiceErrorCodes.NO_SPEECH_DETECTED,
        message: "We couldn't make that out. Please try again from a quieter spot.",
      };
    }

    // Streaming-only path. Clients MUST send Accept: application/x-ndjson.
    // Branches into direct-mode (no webhook needed) or n8n-mode (webhook URL
    // required) based on the agent's aiConfig.routingMode. Legacy non-streaming
    // fallback was removed — every voice consumer uses streaming exclusively.
    const clientAcceptsNdjson = req.headers['accept']?.includes('application/x-ndjson');
    if (!clientAcceptsNdjson) {
      this.log.warn('voiceConversation', 'client does not accept application/x-ndjson', {
        agentId: resolvedAgentId,
      });
      res.status(HttpStatus.NOT_ACCEPTABLE);
      return {
        error: true,
        errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
        message: 'Voice conversation requires a streaming-capable client (Accept: application/x-ndjson).',
      };
    }

    // Resolve full agent for routing-mode + aiConfig inspection. ChatService.resolveAgent
    // returns a stripped projection, so we hit the DB again for the full record.
    // Cheap query (PK lookup) and only runs on the voice endpoint.
    const fullAgent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: resolvedAgentId },
    });
    const routingMode = resolveRoutingMode(fullAgent.aiConfig);
    this.log.info('voiceConversation', 'routing resolved', {
      agentId: resolvedAgentId,
      routingMode,
    });

    let webhookUrl: string | null = null;
    if (routingMode === 'n8n') {
      try {
        webhookUrl = await this.agentsService.getEffectiveWebhookUrl(resolvedAgentId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          this.log.error('voiceConversation', 'failed to fetch webhook URL', error, {
            agentId: resolvedAgentId,
          });
        }
      }
      if (!webhookUrl) {
        this.log.warn('voiceConversation', 'n8n agent has no webhook URL configured', {
          agentId: resolvedAgentId,
        });
        res.status(HttpStatus.PRECONDITION_FAILED);
        return {
          error: true,
          errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
          message: 'Agent is not configured for voice conversations (no webhook URL).',
        };
      }
    }

    let voiceConfig: VoiceConfigDto;
    try {
      voiceConfig = await this.voiceService.getVoiceConfig(resolvedAgentId);
    } catch (error) {
      this.log.warn('voiceConversation', 'failed to fetch voice config — defaulting to TTS enabled', {
        agentId: resolvedAgentId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      voiceConfig = { ttsEnabled: true } as VoiceConfigDto;
    }

    // Direct-mode streaming: agent has aiConfig.routingMode = 'direct', so we
    // bypass n8n entirely and pipe DirectChatService → voice adapter → existing
    // VoiceService.streamingTTS pipeline. No webhook URL needed.
    if (routingMode === 'direct' && voiceConfig.ttsEnabled !== false) {
      await this.handleStreamingVoice(
        dto,
        sttResult,
        sttLatencyMs,
        'direct',
        fullAgent,
        null,
        voiceConfig,
        startTime,
        res,
        resolvedAgentId,
        visitorIp,
      );
      return;
    }

    if (webhookUrl && voiceConfig.ttsEnabled !== false) {
      await this.handleStreamingVoice(
        dto,
        sttResult,
        sttLatencyMs,
        'n8n',
        fullAgent,
        webhookUrl,
        voiceConfig,
        startTime,
        res,
        resolvedAgentId,
        visitorIp,
      );
      return;
    }

    // TTS disabled or no valid routing — return error (legacy sequential path removed)
    this.log.warn('voiceConversation', 'no valid TTS/routing configuration for agent', {
      agentId: resolvedAgentId,
      routingMode,
      ttsEnabled: voiceConfig.ttsEnabled,
    });
    res.status(HttpStatus.PRECONDITION_FAILED);
    return {
      error: true,
      errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
      message: 'Voice conversation requires TTS-enabled agent with a routing configuration.',
    };
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text (STT only)' })
  @ApiResponse({ status: 200, description: 'Transcription result' })
  @ApiResponse({ status: 400, description: 'Invalid input or missing audio file' })
  @ApiResponse({ status: 422, description: 'STT failure or unsupported language' })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_FILE_SIZE } }))
  async transcribe(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body(new ZodValidationPipe(transcribeSchema)) dto: TranscribeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audioValidationError = this.validateAudioFile(audioFile);
    if (audioValidationError) {
      res.status(HttpStatus.BAD_REQUEST);
      return audioValidationError;
    }

    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const clientIp = this.messageRateLimitService.getClientIp(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
      clientIp,
    );
    if (!rateLimitResult.allowed) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    this.log.debug('transcribe', 'STT-only request', {
      agentId: resolvedAgentId,
      audioMime: audioFile.mimetype,
      languageHint: dto.languageHint,
    });
    try {
      const result = await this.voiceService.transcribe({
        audio: audioFile.buffer,
        audioFormat: audioFile.mimetype,
        languageHint: dto.languageHint as SupportedLanguage | undefined,
        agentId: resolvedAgentId,
      });

      return {
        text: result.transcript,
        detectedLanguage: result.detectedLanguage,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error);
      this.log.error('transcribe', 'STT failed', error, {
        agentId: resolvedAgentId,
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
      });
      this.voiceLog.logSttFailed({
        agentId: resolvedAgentId,
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        errorCode,
        error,
      });
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.languageHint ?? 'unknown',
        agentId: resolvedAgentId,
        operation: 'stt',
        errorType: 'stt_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Speech recognition failed',
      };
    }
  }

  @Post('synthesize')
  @ApiOperation({ summary: 'Synthesize text to audio (TTS only)' })
  @ApiResponse({ status: 200, description: 'Synthesized audio result' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 422, description: 'Unsupported language' })
  async synthesize(
    @Body(new ZodValidationPipe(synthesizeSchema)) dto: SynthesizeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const agent = await this.chatService.resolveAgent(dto.agentId);
    const resolvedAgentId = agent.id;

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const clientIp = this.messageRateLimitService.getClientIp(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      resolvedAgentId,
      clientIp,
    );
    if (!rateLimitResult.allowed) {
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: rateLimitResult.message,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      };
    }

    this.log.debug('synthesize', 'TTS-only request', {
      agentId: resolvedAgentId,
      language: dto.language,
      voiceId: dto.voiceId,
      textChars: dto.text.length,
    });
    try {
      const result = await this.voiceService.synthesize({
        text: dto.text,
        language: dto.language as SupportedLanguage,
        voiceId: dto.voiceId,
        speed: dto.speed,
        agentId: resolvedAgentId,
      });

      return {
        audio: result.audio.toString('base64'),
        format: result.audioFormat,
        durationMs: result.durationMs ?? null,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const { errorCode, status } = this.classifyVoiceError(error, 'tts');
      this.log.error('synthesize', 'TTS failed', error, {
        agentId: resolvedAgentId,
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
      });
      this.reportVoiceErrorToSentry(error, {
        provider: error instanceof VoiceProviderError ? error.provider : 'unknown',
        language: dto.language,
        agentId: resolvedAgentId,
        operation: 'tts',
        errorType: 'tts_failure',
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Voice synthesis failed',
      };
    }
  }

  @Get('providers')
  @ApiOperation({ summary: 'List available voice providers and their capabilities' })
  @ApiResponse({ status: 200, description: 'Provider list with supported languages' })
  getProviders() {
    return { providers: this.voiceService.getProvidersInfo() };
  }

  private async handleStreamingVoice(
    dto: VoiceConversationDto,
    sttResult: STTResponse,
    sttLatencyMs: number,
    mode: 'n8n' | 'direct',
    fullAgent: Awaited<ReturnType<PrismaService['agent']['findUniqueOrThrow']>>,
    webhookUrl: string | null,
    voiceConfig: VoiceConfigDto,
    startTime: number,
    res: Response,
    resolvedAgentId: string,
    visitorIp?: string,
  ): Promise<void> {
    // Resolve session for message storage
    const session = await this.chatService.resolveOrCreateSession(resolvedAgentId, dto.sessionId, dto.source ?? 'WIDGET', visitorIp);
    this.log.debug('handleStreamingVoice', 'streaming voice turn starting', {
      agentId: resolvedAgentId,
      sessionId: session.sessionId,
      mode,
    });

    // Set chunked response headers. X-Message-Id is set on the AI path only —
    // the paused branch below persists the inbound via recordPausedInbound.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Session-Id', session.id);

    // Transcription chunk — shown to the caller regardless of handover state so
    // they always see what we heard. `sessionId` (external public id) lets
    // multi-turn voice clients round-trip it on the next request.
    const transcriptionChunk = {
      type: 'transcription' as const,
      sessionId: session.sessionId,
      text: sttResult.transcript,
      detectedLanguage: sttResult.detectedLanguage,
      confidence: sttResult.confidence,
      sttLatencyMs,
    };

    // Human handover: a teammate is handling this conversation → no AI audio
    // reply on the voice route. Show the caller's transcription, capture it for
    // the dashboard, and stop. recordPausedInbound persists the USER message, so
    // we must NOT also saveUserMessage here (that was a double-persist bug). The
    // human responds from the dashboard — live voice takeover isn't supported.
    if (this.chatService.isPausedForHuman(session)) {
      res.write(JSON.stringify(transcriptionChunk) + '\n');
      await this.chatService.recordPausedInbound(
        session,
        fullAgent.organizationId,
        sttResult.transcript,
      );
      if (!res.writableEnded) {
        res.write(
          JSON.stringify({ type: 'paused', sessionId: session.sessionId, handoverState: 'ACTIVE_HUMAN' }) + '\n',
        );
        res.end();
      }
      return;
    }

    // Normal AI path: persist the inbound + expose its id, then show transcription.
    const userMessage = await this.chatService.saveUserMessage(
      session.id,
      sttResult.transcript,
      undefined,
      ChatService.isPiiRedactionEnabled(fullAgent.aiConfig) ? fullAgent.organizationId : undefined,
    );
    res.setHeader('X-Message-Id', userMessage.id);
    res.write(JSON.stringify(transcriptionChunk) + '\n');

    // "Talk to a human" in a voice turn escalates (keyword, no LLM; gated on
    // takeover). Parity with the widget text path: the bot acknowledges via the
    // stall instruction, and we signal the widget so it shows the "connecting"
    // line + starts polling for the teammate's replies (which arrive as text).
    const escalated = await this.chatService.maybeEscalateToHuman(
      session,
      fullAgent,
      sttResult.transcript,
    );
    const inRequested = escalated || session.handoverState === 'REQUESTED';
    // On a bot-handled voice turn, hand the model the connect_to_human tool so it
    // can escalate on frustration / explicit consent — parity with the text path.
    let toolEscalated = false;
    const offerHumanTools =
      fullAgent.humanTakeoverEnabled && session.source !== 'DEMO' && !inRequested
        ? {
            connect_to_human: this.chatService.buildHumanConnectTool(
              session,
              fullAgent.organizationId,
              () => {
                toolEscalated = true;
              },
            ),
          }
        : undefined;
    if (inRequested) {
      res.write(
        JSON.stringify({
          type: 'handover',
          sessionId: session.sessionId,
          handoverState: 'REQUESTED',
        }) + '\n',
      );
    }

    // Client disconnect handling
    let closed = false;
    const abortController = new AbortController();

    // Stream watchdogs.
    //
    // This used to be a single fixed 60s deadline on the whole turn, which killed
    // long-but-perfectly-healthy replies: a ten-sentence answer synthesised one
    // sentence at a time can legitimately run past a minute, and the visitor got
    // "Voice processing timed out" mid-sentence with audio still playing. What
    // actually needs catching is a STALLED stream, so the deadline is now IDLE
    // based and re-armed on every chunk written (matching the widget's own idle
    // timeout), with a hard ceiling as the backstop against a stream that
    // trickles forever.
    //
    // The wait for the FIRST chunk gets its own, longer window: nothing can be
    // emitted until the LLM has produced a sentence AND its TTS has returned
    // first bytes, and a provider that has to time out its WebSocket (12-15s)
    // and fall back to batch HTTP stacks on top of that. Real turns in this
    // system have taken 32s to first audio and then completed fine, so a plain
    // idle window sized for mid-stream gaps would kill them.
    const VOICE_STREAM_FIRST_CHUNK_TIMEOUT_MS = 45_000;
    const VOICE_STREAM_IDLE_TIMEOUT_MS = 25_000;
    const VOICE_STREAM_MAX_TOTAL_MS = 180_000;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let totalTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStreamTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = null;
      }
    };
    let streamProgressed = false;
    const failStream = (reason: 'first-chunk' | 'idle' | 'total') => {
      if (closed) return;
      this.log.warn('handleStreamingVoice', 'voice stream timed out', {
        agentId: resolvedAgentId,
        sessionId: session.sessionId,
        reason,
        elapsedMs: Date.now() - startTime,
      });
      const timeoutChunk = {
        type: 'error' as const,
        errorCode: voiceErrorCodes.PROVIDER_TIMEOUT,
        message: 'Voice stream timeout — response took too long',
      };
      res.write(JSON.stringify(timeoutChunk) + '\n');
      res.end();
      closed = true;
      abortController.abort();
      clearStreamTimers();
    };
    totalTimer = setTimeout(() => failStream('total'), VOICE_STREAM_MAX_TOTAL_MS);
    const armIdleTimeout = () => {
      if (closed) return;
      if (idleTimer) clearTimeout(idleTimer);
      // Capture the reason at arm time — by the time the timer fires,
      // streamProgressed may have flipped for a LATER re-arm, not this one.
      const reason = streamProgressed ? 'idle' : 'first-chunk';
      const windowMs = streamProgressed
        ? VOICE_STREAM_IDLE_TIMEOUT_MS
        : VOICE_STREAM_FIRST_CHUNK_TIMEOUT_MS;
      idleTimer = setTimeout(() => failStream(reason), windowMs);
    };
    armIdleTimeout();

    // Visitor closed the tab / aborted the fetch — stop synthesising and drop the
    // watchdogs so nothing is left holding this request's closure.
    res.on('close', () => {
      closed = true;
      abortController.abort();
      clearStreamTimers();
    });

    // Build the token stream from either direct-mode LLM or the legacy n8n
    // webhook, depending on the agent's routing mode. Both sources yield
    // chunks in N8nStreamChunk format (the direct-mode path adapts via
    // directChatToN8nStream) so the downstream voice pipeline is unchanged.
    //
    // For direct mode, we also capture the LLM's per-turn result (ttftMs,
    // tokens, cost, model, finishReason) via the adapter's onFinish callback
    // so we can persist them into the assistant-message metadata below — that
    // gives analytics a full STT/LLM/TTS breakdown per voice turn instead of
    // only the aggregate timings.
    let tokenStream: AsyncGenerator<N8nStreamChunk>;
    let llmResult: DirectChatResult | null = null;
    if (mode === 'direct') {
      const directStream = this.directChatService.stream({
        agent: fullAgent,
        chatSessionId: session.id,
        externalSessionId: session.sessionId,
        newUserMessage: sttResult.transcript,
        feature: 'voice',
        abortSignal: abortController.signal,
        // Already mid-handover → stall politely; otherwise offer/escalate via tool.
        extraSystemInstruction: inRequested
          ? this.chatService.handoverStallInstruction(fullAgent)
          : offerHumanTools
            ? this.chatService.humanOfferInstruction()
            : undefined,
        tools: offerHumanTools,
        maxSteps: offerHumanTools ? 3 : undefined,
      });
      tokenStream = directChatToN8nStream(directStream, (r) => {
        llmResult = r;
      });
    } else {
      if (!webhookUrl) {
        // Should never happen — routing mode was 'n8n' but webhookUrl absent.
        // Defensive: surface a clear error rather than crashing mid-stream.
        throw new Error(
          'handleStreamingVoice called in n8n mode without a webhookUrl',
        );
      }
      tokenStream = this.n8nStreamingService.streamFromWebhookUrl(
        webhookUrl,
        sttResult.transcript,
        session.sessionId,
        abortController.signal,
      );
    }

    const ttsLatencies: number[] = [];
    // Track WS-specific metrics across all sentences when streaming was used.
    // We aggregate then write into the assistant-message metadata so analytics
    // can compare batch vs WS performance per turn.
    const wsFirstChunkLatencies: number[] = [];
    const wsChunkCounts: number[] = [];
    let wsTotalBytes = 0;
    const ttsProtocols = new Set<'http' | 'websocket'>();
    const ttsProviders = new Set<string>();
    let fullText = '';
    let totalSentences = 0;
    let timeToFirstChunkMs: number | null = null;

    try {
      const voiceStream = this.voiceService.streamingTTS(
        tokenStream,
        sttResult.detectedLanguage,
        resolvedAgentId,
        voiceConfig,
      );

      for await (const chunk of voiceStream) {
        if (closed) break;

        if (chunk.type === 'audio') {
          // Emoji-only chunks carry display text but no audio (stripped from TTS,
          // ttsLatencyMs 0). Forward them for the transcript, but EXCLUDE from
          // audio metrics so they don't skew first-audio timing / latency /
          // protocol. Distinct from real per-sentence final markers, which have
          // EMPTY text but carry genuine ws totals and must still aggregate.
          const isTextOnly = !chunk.audio && !!chunk.text;
          if (!isTextOnly) {
            // `timeToFirstChunkMs` = when the user first hears ANY audio. With
            // per-chunk WS delivery this lands EARLIER than before (first audio
            // bytes of the first sentence) — that's the perceptual win we're
            // measuring.
            if (timeToFirstChunkMs === null) {
              timeToFirstChunkMs = Date.now() - startTime;
            }
            if (chunk.ttsProtocol) ttsProtocols.add(chunk.ttsProtocol);
            if (chunk.ttsProvider) ttsProviders.add(chunk.ttsProvider);
            // First-chunk + final-chunk markers carry the per-sentence WS
            // diagnostics. Aggregate across the turn.
            if (chunk.wsFirstChunkLatencyMs !== undefined) {
              wsFirstChunkLatencies.push(chunk.wsFirstChunkLatencyMs);
            }
            if (chunk.isFinalChunk) {
              // Per-sentence totals are only meaningful on the LAST chunk —
              // that's when sentence-level latency is settled.
              ttsLatencies.push(chunk.ttsLatencyMs);
              if (chunk.wsChunkCount !== undefined) wsChunkCounts.push(chunk.wsChunkCount);
              if (chunk.wsTotalBytes !== undefined) wsTotalBytes += chunk.wsTotalBytes;
            }
          }
        }
        if (chunk.type === 'end') {
          fullText = chunk.fullText;
          totalSentences = chunk.totalSentences;
        }
        if (chunk.type === 'error') {
          // A sentence failed TTS on every provider (e.g. provider outage) and
          // is surfaced to the client below. Log it loudly to the console AND as
          // a queryable event_logs row (VOICE_TTS_SENTENCE_FAILED) — the generic
          // provider-level rows alone weren't enough to debug these. The specific
          // reason is on the same-correlationId SARVAM_TTS_FAILED row.
          this.log.error('handleStreamingVoice', 'TTS sentence failed', undefined, {
            agentId: resolvedAgentId,
            sessionId: session.sessionId,
            sentenceIndex: chunk.sentenceIndex,
            errorCode: chunk.errorCode,
          });
          this.voiceLog.logTtsSentenceFailed({
            agentId: resolvedAgentId,
            sessionId: session.sessionId,
            visitorId: visitorIp,
            sentenceIndex: chunk.sentenceIndex,
            errorCode: chunk.errorCode,
            message: chunk.message,
          });
        }
        res.write(JSON.stringify(chunk) + '\n');
        // Progress — the stream is alive, so push the deadline back out. From
        // here on the tighter mid-stream idle window applies.
        streamProgressed = true;
        armIdleTimeout();
      }
    } catch (error) {
      if (!closed) {
        this.log.error('handleStreamingVoice', 'streaming voice pipeline failed', error, {
          agentId: resolvedAgentId,
          sessionId: session.sessionId,
        });
        this.voiceLog.logException({
          agentId: resolvedAgentId,
          sessionId: session.sessionId,
          visitorId: visitorIp,
          error,
        });
        this.reportVoiceErrorToSentry(error, {
          provider: 'streaming',
          language: sttResult.detectedLanguage,
          agentId: resolvedAgentId,
          operation: 'tts',
          errorType: 'streaming_voice_failure',
        });
        const errorChunk = {
          type: 'error' as const,
          errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
          message: 'Streaming voice pipeline failed',
        };
        res.write(JSON.stringify(errorChunk) + '\n');
      }
    } finally {
      clearStreamTimers();
      // Model escalated mid-stream via connect_to_human → tell the widget so it
      // shows the "connecting" line + starts polling for the teammate's replies.
      if (toolEscalated && !closed && !res.writableEnded) {
        res.write(
          JSON.stringify({
            type: 'handover',
            sessionId: session.sessionId,
            handoverState: 'REQUESTED',
          }) + '\n',
        );
      }
      if (!closed) {
        res.end();
      }
    }

    // Store assistant message and user message metadata
    const averageTtsLatencyMs = ttsLatencies.length > 0
      ? Math.round(ttsLatencies.reduce((a, b) => a + b, 0) / ttsLatencies.length)
      : 0;

    // Pull LLM metrics off the direct-mode result if present. We spread these
    // into the metadata at the top level (rather than nesting under `llm:`) so
    // existing analytics queries that look for `model` / `ttftMs` / `cost` on
    // text messages also work for voice messages.
    const llmMetadata: Record<string, unknown> =
      mode === 'direct' && llmResult
        ? {
            model: (llmResult as DirectChatResult).model,
            llmTtftMs: (llmResult as DirectChatResult).ttftMs,
            llmLatencyMs: (llmResult as DirectChatResult).latencyMs,
            inputTokens: (llmResult as DirectChatResult).usage.inputTokens,
            outputTokens: (llmResult as DirectChatResult).usage.outputTokens,
            totalTokens: (llmResult as DirectChatResult).usage.totalTokens,
            cachedInputTokens:
              (llmResult as DirectChatResult).usage.cachedInputTokens ?? null,
            reasoningTokens:
              (llmResult as DirectChatResult).usage.reasoningTokens ?? null,
            cost: (llmResult as DirectChatResult).cost,
            finishReason: (llmResult as DirectChatResult).finishReason,
            traceId: (llmResult as DirectChatResult).traceId,
            historyCount: (llmResult as DirectChatResult).historyCount,
            historyTruncated: (llmResult as DirectChatResult).historyTruncated,
          }
        : {};

    // Aggregate WS-specific metrics across all sentences. Mixed-transport
    // turns (some sentences streamed, some fell back to batch) are reported
    // with `ttsProtocol: 'mixed'` so analytics can spot the failure-fallback
    // pattern.
    const wsAvgFirstChunkLatencyMs =
      wsFirstChunkLatencies.length > 0
        ? Math.round(
            wsFirstChunkLatencies.reduce((a, b) => a + b, 0) /
              wsFirstChunkLatencies.length,
          )
        : null;
    const wsTotalChunks =
      wsChunkCounts.length > 0
        ? wsChunkCounts.reduce((a, b) => a + b, 0)
        : null;
    const ttsProtocol: 'http' | 'websocket' | 'mixed' | null =
      ttsProtocols.size === 0
        ? null
        : ttsProtocols.size === 1
          ? (ttsProtocols.values().next().value as 'http' | 'websocket')
          : 'mixed';
    // Which provider(s) actually synthesized this turn: a single name, or
    // 'mixed' when a sentence fell back from one provider to another.
    const ttsProvider: string | null =
      ttsProviders.size === 0
        ? null
        : ttsProviders.size === 1
          ? (ttsProviders.values().next().value as string)
          : 'mixed';

    const metadata = {
      inputType: 'voice' as const,
      streaming: true,
      routingMode: mode,
      detectedLanguage: sttResult.detectedLanguage,
      languageConfidence: sttResult.confidence,
      sttProvider: sttResult.provider ?? null,
      sttLatencyMs,
      totalSentences,
      averageTtsLatencyMs,
      timeToFirstChunkMs,
      totalLatencyMs: Date.now() - startTime,
      // WS-streaming TTS instrumentation. Null/absent on batch-only turns so
      // existing analytics queries that COALESCE these to 0 still work.
      ttsProtocol,
      ttsProvider,
      wsAvgFirstChunkLatencyMs,
      wsTotalChunks,
      wsTotalBytes: wsTotalBytes > 0 ? wsTotalBytes : null,
      ...llmMetadata,
      ...detectFallback(fullText, fullAgent.fallbackPhrases),
    };

    // A voice turn that produced NO reply text (saved as "[streaming failed]")
    // is a FAILURE, not a reply — previously it still logged VOICE_REPLY_SENT as
    // a success, hiding it. Log it loudly + as a queryable VOICE_STREAM_FAILED
    // event instead. Handover turns legitimately produce no bot text, so exclude
    // those. The LLM-level reason lives on the paired DirectChatService trace.
    const producedReply = !!fullText;
    const isHandoverTurn = toolEscalated || inRequested;
    if (!producedReply && !isHandoverTurn) {
      this.log.error('handleStreamingVoice', 'voice turn produced no reply', undefined, {
        agentId: resolvedAgentId,
        sessionId: session.sessionId,
        clientAborted: closed,
        totalSentences,
        totalLatencyMs: metadata.totalLatencyMs,
      });
      this.voiceLog.logStreamFailed({
        agentId: resolvedAgentId,
        sessionId: session.sessionId,
        visitorId: visitorIp,
        clientAborted: closed,
        latencyMs: metadata.totalLatencyMs,
        reason: closed ? 'client_disconnected' : 'empty_reply',
      });
    } else {
      this.log.info('handleStreamingVoice', 'voice reply streamed', {
        agentId: resolvedAgentId,
        sessionId: session.sessionId,
        totalSentences,
        replyChars: fullText.length,
        totalLatencyMs: metadata.totalLatencyMs,
      });
      // VOICE channel event: the assistant's audio+text reply was streamed back.
      // metadata carries the STT/TTS/LLM breakdown (no audio bytes / full text).
      this.voiceLog.logReplySent({
        agentId: resolvedAgentId,
        sessionId: session.sessionId,
        visitorId: visitorIp,
        latencyMs: metadata.totalLatencyMs,
        metadata: {
          routingMode: mode,
          sttProvider: metadata.sttProvider,
          ttsProvider: metadata.ttsProvider,
          ttsProtocol: metadata.ttsProtocol,
          model: llmMetadata.model,
          totalSentences,
          replyChars: fullText.length,
        },
      });
    }

    const userMetadata = {
      inputType: 'voice' as const,
      detectedLanguage: sttResult.detectedLanguage,
      languageConfidence: sttResult.confidence,
      sttProvider: sttResult.provider ?? 'unknown',
      sttLatencyMs,
    };
    try {
      await Promise.all([
        fullText
          ? this.chatService.saveAssistantMessage(session.id, fullText, metadata)
          : this.chatService.saveAssistantMessage(session.id, '[streaming failed]', { ...metadata, error: true }),
        this.prisma.chatMessage.update({
          where: { id: userMessage.id },
          data: { metadata: userMetadata },
        }),
        // Mirror the voice USER message's STT metrics into typed columns so
        // analytics counts it as a voice turn (and tracks the STT provider).
        this.messageMetricsService.recordFromMetadata(userMessage.id, userMessage.createdAt, userMetadata),
        // Keep ChatSession.lastMessageAt in lockstep with the text flow so
        // voice sessions sort alongside widget chats on the dashboard
        // Conversations list. Without this, voice sessions stay null forever.
        this.chatService.updateSessionTimestamp(session.id),
      ]);
    } catch (err) {
      this.log.warn('handleStreamingVoice', 'failed to save streaming voice messages', {
        sessionId: session.sessionId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    // Ping the dashboard so a watching teammate sees the live voice exchange
    // while a human is being connected (keyword escalation or the model's tool).
    if (inRequested || toolEscalated) {
      await this.chatService.publishHandoverBotTurn(session, fullAgent.organizationId);
    }
  }

  private validateAudioFile(file: Express.Multer.File): { error: true; errorCode: string; message: string } | null {
    if (!file) {
      return { error: true, errorCode: voiceErrorCodes.INVALID_AUDIO, message: 'Audio file is required' };
    }
    if (!ALLOWED_AUDIO_MIMES.has(file.mimetype)) {
      return {
        error: true,
        errorCode: voiceErrorCodes.INVALID_AUDIO,
        message: `Invalid audio format: ${file.mimetype}. Allowed: ${[...ALLOWED_AUDIO_MIMES].join(', ')}`,
      };
    }
    return null;
  }

  private classifyVoiceError(error: unknown, operation: 'stt' | 'tts' = 'stt'): { errorCode: string; status: number } {
    if (error instanceof UnsupportedLanguageError) {
      return { errorCode: voiceErrorCodes.UNSUPPORTED_LANGUAGE, status: HttpStatus.UNPROCESSABLE_ENTITY };
    }
    if (error instanceof VoiceProviderError) {
      const providerStatus = error.getStatus();
      if (providerStatus === HttpStatus.GATEWAY_TIMEOUT) {
        return { errorCode: voiceErrorCodes.PROVIDER_TIMEOUT, status: HttpStatus.GATEWAY_TIMEOUT };
      }
      return { errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE, status: providerStatus };
    }
    const fallbackCode = operation === 'tts' ? voiceErrorCodes.TTS_FAILED : voiceErrorCodes.STT_FAILED;
    return { errorCode: fallbackCode, status: HttpStatus.UNPROCESSABLE_ENTITY };
  }

  private reportVoiceErrorToSentry(
    error: unknown,
    context: {
      provider: string;
      language: string;
      agentId: string;
      operation: 'stt' | 'tts';
      errorType?: string;
      fallbackAttempted?: boolean;
    },
    level: 'error' | 'warning' = 'error',
  ): void {
    Sentry.withScope((scope) => {
      scope.setContext('voice', context);
      scope.setLevel(level);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(`Voice ${context.operation} failure`, { level });
      }
    });
  }
}
