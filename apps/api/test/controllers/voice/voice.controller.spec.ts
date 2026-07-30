import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { VoiceController } from '../../../src/modules/voice/voice.controller';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import { ChatService } from '../../../src/services/chat.service';
import { MessageMetricsService } from '../../../src/services/message-metrics.service';
import { N8nStreamingService } from '../../../src/services/n8n-streaming.service';
import { AgentsService } from '../../../src/services/agents.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { DirectChatService } from '../../../src/modules/ai/direct-chat.service';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';
import { VoiceEventLogger } from '../../../src/common/events/voice.logger';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
} from '../../../src/modules/voice/providers/voice-provider.interface';
import { voiceErrorCodes } from '@repo/validation';

jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((cb: (scope: { setContext: jest.Mock; setLevel: jest.Mock }) => void) => {
    cb({ setContext: jest.fn(), setLevel: jest.fn() });
  }),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

interface ErrorResult {
  error: boolean;
  errorCode: string;
  message: string;
  retryAfterSeconds?: number;
}

describe('VoiceController', () => {
  let controller: VoiceController;

  const AGENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const SESSION_ID = 'session-uuid-1234';

  const mockVoiceService = {
    getRegisteredProviders: jest.fn(),
    getProvidersInfo: jest.fn(),
    transcribe: jest.fn(),
    synthesize: jest.fn(),
    getVoiceConfig: jest.fn(),
    streamingTTS: jest.fn(),
  };

  const mockChatService = {
    sendMessage: jest.fn(),
    resolveAgent: jest.fn(),
    resolveOrCreateSession: jest.fn(),
    saveUserMessage: jest.fn(),
    saveAssistantMessage: jest.fn(),
    isPausedForHuman: jest.fn().mockReturnValue(false),
    recordPausedInbound: jest.fn().mockResolvedValue(undefined),
    maybeEscalateToHuman: jest.fn().mockResolvedValue(false),
    publishHandoverBotTurn: jest.fn().mockResolvedValue(undefined),
    handoverStallInstruction: jest.fn().mockReturnValue('A teammate is joining.'),
    buildHumanConnectTool: jest.fn().mockReturnValue({}),
    humanOfferInstruction: jest.fn().mockReturnValue('Offer a human if needed.'),
  };

  const mockN8nStreamingService = {
    streamFromWebhookUrl: jest.fn(),
  };

  const mockAgentsService = {
    getEffectiveWebhookUrl: jest.fn(),
  };

  const mockPrismaService = {
    chatMessage: {
      update: jest.fn().mockResolvedValue({}),
    },
    // Voice controller now does `prisma.agent.findUniqueOrThrow({ where: { id }})`
    // to get the full Agent row (with aiConfig) before routing the LLM call —
    // resolveAgent returns a stripped projection that doesn't have aiConfig.
    // Mock returns a baseline direct-mode agent that all routing tests can use;
    // individual tests override aiConfig if they need n8n mode.
    agent: {
      findUniqueOrThrow: jest.fn(),
    },
  };

  const mockMessageRateLimitService = {
    checkMessageRateLimit: jest.fn(),
    getDeviceIdentifier: jest.fn(),
    getClientIp: jest.fn(),
  };

  const mockVoiceEventLogger = {
    logConversationReceived: jest.fn(),
    logReplySent: jest.fn(),
    logException: jest.fn(),
    logSttFailed: jest.fn(),
    logTtsSentenceFailed: jest.fn(),
  };

  // Mirrors real behaviour: loopback → undefined, real IP → vh_ hash.
  // Implementation applied in beforeEach (jest resetMocks: true).
  const mockCrypto = { hashVisitorIp: jest.fn() };
  const hashVisitorIpImpl = (ip?: string | null) =>
    !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.')
      ? undefined
      : `vh_${ip}`;

  function createMockRequest(headers?: Record<string, string>): Request {
    return {
      headers: { 'x-device-id': 'test-device', ...headers },
      ip: '127.0.0.1',
    } as unknown as Request;
  }

  function createMockResponse(): Response {
    const res = {
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  }

  function createMockAudioFile(
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File {
    return {
      fieldname: 'audio',
      originalname: 'recording.webm',
      encoding: '7bit',
      mimetype: 'audio/webm',
      buffer: Buffer.from('fake-audio-data'),
      size: 1024,
      stream: null as unknown as Express.Multer.File['stream'],
      destination: '',
      filename: '',
      path: '',
      ...overrides,
    };
  }

  const mockSttResult = {
    transcript: 'Hello, how are you?',
    confidence: 0.95,
    detectedLanguage: 'en' as const,
    provider: 'deepgram',
    latencyMs: 150,
  };

  const mockChatResult = {
    sessionId: SESSION_ID,
    messageId: 'msg-uuid',
    reply: 'I am doing great, thanks!',
    assistantMessageId: 'assistant-msg-uuid',
    metadata: {
      backendReceivedAt: '2026-03-21T10:00:00.000Z',
      n8nReceivedAt: '2026-03-21T10:00:00.500Z',
      agentRepliedAt: '2026-03-21T10:00:01.200Z',
      backendRespondedAt: '2026-03-21T10:00:01.300Z',
      responseLatencyMs: 1300,
    },
  };

  const mockTtsResult = {
    audio: Buffer.from('synthesized-audio'),
    audioFormat: 'audio/mp3',
    durationMs: 2000,
    provider: 'elevenlabs',
    latencyMs: 300,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.hashVisitorIp.mockImplementation(hashVisitorIpImpl);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: ChatService, useValue: mockChatService },
        { provide: N8nStreamingService, useValue: mockN8nStreamingService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MessageRateLimitService, useValue: mockMessageRateLimitService },
        { provide: DirectChatService, useValue: { send: jest.fn(), stream: jest.fn() } },
        { provide: MessageMetricsService, useValue: { record: jest.fn(), recordFromMetadata: jest.fn() } },
        { provide: VoiceEventLogger, useValue: mockVoiceEventLogger },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);

    // Default: resolve agent (publicId → UUID)
    mockChatService.resolveAgent.mockResolvedValue({ id: AGENT_ID, hmacEnabled: false });

    // Default: rate limit allowed
    mockMessageRateLimitService.getDeviceIdentifier.mockReturnValue('test-device');
    mockMessageRateLimitService.getClientIp.mockReturnValue('203.0.113.1');
    mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({ allowed: true });

    // Default: webhook URL configured (streaming is the only path now).
    // Tests that need to exercise the "no webhook" 412 branch override per-test.
    mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/abc');

    // Default: prisma mocks
    mockPrismaService.chatMessage.update.mockResolvedValue({});
    // Full Agent row used by the voice controller's `findUniqueOrThrow` call.
    // Defaults to direct-mode (aiConfig.routingMode = 'direct') because that
    // is the production path; the few legacy n8n-mode tests override per-test.
    mockPrismaService.agent.findUniqueOrThrow.mockResolvedValue({
      id: AGENT_ID,
      hmacEnabled: false,
      aiConfig: { routingMode: 'direct' },
      systemPrompt: '',
      organizationId: 'org-id',
    });

    // Default: TTS enabled
    mockVoiceService.getVoiceConfig.mockResolvedValue({
      sttEnabled: true,
      ttsEnabled: true,
      defaultLanguage: 'en',
      supportedLanguages: ['en'],
      ttsSpeed: 1.0,
      autoDetectLanguage: true,
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================
  // POST /voice/conversation (streaming-only)
  // ============================
  describe('voiceConversation (streaming-only)', () => {
    function streamingReq(): Request {
      return createMockRequest({ accept: 'application/x-ndjson' });
    }

    it('should return 406 if the client does not accept application/x-ndjson', async () => {
      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest(); // no Accept header
      const res = createMockResponse();
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      const result = (await controller.voiceConversation(audioFile, dto, req, res)) as ErrorResult;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_ACCEPTABLE);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(mockN8nStreamingService.streamFromWebhookUrl).not.toHaveBeenCalled();
    });

    it('should return 412 if the agent has no webhook URL configured', async () => {
      // This test exercises the n8n routing path — override the default
      // direct-mode agent with an n8n one. getEffectiveWebhookUrl is only
      // consulted in n8n mode.
      mockPrismaService.agent.findUniqueOrThrow.mockResolvedValueOnce({
        id: AGENT_ID,
        hmacEnabled: false,
        aiConfig: { routingMode: 'n8n' },
        systemPrompt: '',
        organizationId: 'org-id',
      });
      mockAgentsService.getEffectiveWebhookUrl.mockRejectedValueOnce(new Error('No webhook URL'));
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const res = createMockResponse();

      const result = (await controller.voiceConversation(audioFile, dto, streamingReq(), res)) as ErrorResult;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.PRECONDITION_FAILED);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(mockN8nStreamingService.streamFromWebhookUrl).not.toHaveBeenCalled();
    });

    it('should return RATE_LIMITED before checking streaming requirements', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValueOnce({
        allowed: false,
        message: 'Slow down',
        retryAfterSeconds: 30,
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const res = createMockResponse();

      const result = (await controller.voiceConversation(audioFile, dto, streamingReq(), res)) as ErrorResult;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(result.errorCode).toBe(voiceErrorCodes.RATE_LIMITED);
    });

    it('should return NO_SPEECH_DETECTED when STT yields an empty transcript', async () => {
      mockVoiceService.transcribe.mockResolvedValueOnce({ ...mockSttResult, transcript: '   ' });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const res = createMockResponse();

      const result = (await controller.voiceConversation(audioFile, dto, streamingReq(), res)) as ErrorResult;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(result.errorCode).toBe(voiceErrorCodes.NO_SPEECH_DETECTED);
    });
  });

  // ============================
  // POST /voice/transcribe
  // ============================
  describe('transcribe', () => {
    it('should return STT result with all fields', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, languageHint: 'hi' as const };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.transcribe(audioFile, dto, req, res);

      expect(result).toEqual({
        text: 'Hello, how are you?',
        detectedLanguage: 'en',
        confidence: 0.95,
        latencyMs: 150,
      });
    });

    it('should pass audio buffer and mimetype to voiceService', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      const audioFile = createMockAudioFile({ mimetype: 'audio/wav' });
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.transcribe(audioFile, dto, req, res);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith({
        audio: audioFile.buffer,
        audioFormat: 'audio/wav',
        languageHint: undefined,
        agentId: AGENT_ID,
      });
    });

    it('should return rate limit error with RATE_LIMITED errorCode', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 30,
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.transcribe(audioFile, dto, req, res) as ErrorResult;

      expect(result).toEqual({
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 30,
      });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('should return structured error on STT failure', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('deepgram', 'API returned 500'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.transcribe(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(result.message).toBe('Speech recognition failed');
    });
  });

  // ============================
  // POST /voice/synthesize
  // ============================
  describe('synthesize', () => {
    it('should return TTS result with base64 audio', async () => {
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const dto = { text: 'Hello world', language: 'en' as const, agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.synthesize(dto, req, res);

      expect(result).toEqual({
        audio: mockTtsResult.audio.toString('base64'),
        format: 'audio/mp3',
        durationMs: 2000,
        latencyMs: 300,
      });
    });

    it('should pass optional voiceId and speed to voiceService', async () => {
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const dto = {
        text: 'Namaste',
        language: 'hi' as const,
        voiceId: 'voice-123',
        speed: 1.5,
        agentId: AGENT_ID,
      };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.synthesize(dto, req, res);

      expect(mockVoiceService.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: 'voice-123',
          speed: 1.5,
        }),
      );
    });

    it('should return rate limit error with RATE_LIMITED errorCode', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You've sent too many messages. Please try again later.",
        retryAfterSeconds: 60,
      });

      const dto = { text: 'Hello', language: 'en' as const, agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.synthesize(dto, req, res) as ErrorResult;

      expect(result).toEqual({
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: "You've sent too many messages. Please try again later.",
        retryAfterSeconds: 60,
      });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('should return structured error on TTS failure', async () => {
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'API returned 500'),
      );

      const dto = { text: 'Hello', language: 'en' as const, agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.synthesize(dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(result.message).toBe('Voice synthesis failed');
    });
  });

  // ============================
  // GET /voice/providers
  // ============================
  describe('getProviders', () => {
    it('should return provider list from voiceService', () => {
      const providersInfo = [
        { name: 'sarvam', stt: true, tts: true, languages: ['hi', 'en'] },
        { name: 'deepgram', stt: true, tts: false, languages: ['en'] },
        { name: 'elevenlabs', stt: true, tts: true, languages: ['en', 'hi'] },
      ];
      mockVoiceService.getProvidersInfo.mockReturnValue(providersInfo);

      const result = controller.getProviders();

      expect(result).toEqual({ providers: providersInfo });
      expect(mockVoiceService.getProvidersInfo).toHaveBeenCalledTimes(1);
    });

    it('should return empty list when no routable providers', () => {
      mockVoiceService.getProvidersInfo.mockReturnValue([]);

      const result = controller.getProviders();

      expect(result).toEqual({ providers: [] });
    });
  });

  // ============================
  // File validation
  // ============================
  describe('file validation', () => {
    it('should return INVALID_AUDIO error when no audio file provided', async () => {
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(
        undefined as unknown as Express.Multer.File, dto, req, res,
      ) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.INVALID_AUDIO);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('should return INVALID_AUDIO error for invalid MIME type', async () => {
      const audioFile = createMockAudioFile({ mimetype: 'application/pdf' });
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.INVALID_AUDIO);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('should return INVALID_AUDIO error when no audio file on transcribe endpoint', async () => {
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.transcribe(
        undefined as unknown as Express.Multer.File, dto, req, res,
      ) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.INVALID_AUDIO);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('should accept all valid audio MIME types including Safari/iOS formats', async () => {
      const validMimes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac'];

      for (const mimetype of validMimes) {
        mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
        mockChatService.sendMessage.mockResolvedValue(mockChatResult);
        mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

        const audioFile = createMockAudioFile({ mimetype });
        const dto = { agentId: AGENT_ID };
        const req = createMockRequest();
        const res = createMockResponse();

        await expect(
          controller.voiceConversation(audioFile, dto, req, res),
        ).resolves.toBeDefined();
      }
    });
  });

  // ============================
  // Structured error handling (Story 10-13)
  // ============================
  describe('structured error handling', () => {
    it('should return structured STT_FAILED error on STT failure', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new Error('Unexpected STT failure'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.STT_FAILED);
      expect(result.message).toBe('Speech recognition failed');
      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('should return UNSUPPORTED_LANGUAGE error for UnsupportedLanguageError', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new UnsupportedLanguageError('deepgram', 'unknown-lang'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.UNSUPPORTED_LANGUAGE);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('should return PROVIDER_TIMEOUT error for 504 provider errors', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('deepgram', 'Request timed out after 10s', HttpStatus.GATEWAY_TIMEOUT),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_TIMEOUT);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.GATEWAY_TIMEOUT);
    });

    it('should return PROVIDER_UNAVAILABLE error for general provider errors', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('sarvam', 'API returned 500'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    });

    it('should report STT errors to Sentry with voice context', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('deepgram', 'API failure'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, languageHint: 'hi' as const };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(Sentry.withScope).toHaveBeenCalled();
    });
  });

  // ============================
  // Streaming Voice Pipeline
  // ============================
  describe('voiceConversation - streaming path', () => {
    function createMockStreamingResponse(): Response & {
      writtenChunks: string[];
      ended: boolean;
    } {
      const writtenChunks: string[] = [];
      return {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        write: jest.fn((data: string) => { writtenChunks.push(data); }),
        end: jest.fn(),
        on: jest.fn(),
        writtenChunks,
        ended: false,
      } as unknown as Response & { writtenChunks: string[]; ended: boolean };
    }

    const mockSession = { id: 'session-123', sessionId: 'ext-session-123' };
    const mockUserMessage = { id: 'user-msg-123' };

    beforeEach(() => {
      // Enable streaming path
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/agent-1');
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockChatService.saveUserMessage.mockResolvedValue(mockUserMessage);
      mockChatService.saveAssistantMessage.mockResolvedValue({ id: 'assistant-msg-123' });
    });

    it('should use streaming path when webhookUrl is available', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      async function* mockVoiceStream() {
        yield { type: 'audio' as const, sentenceIndex: 0, text: 'Hello!', audio: 'base64audio', audioFormat: 'audio/mp3', audioDurationMs: 1000, ttsLatencyMs: 50 };
        yield { type: 'end' as const, fullText: 'Hello!', totalSentences: 1 };
      }
      mockVoiceService.streamingTTS.mockReturnValue(mockVoiceStream());
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue((async function*() {
        yield { type: 'item', content: 'Hello!' };
      })());

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockStreamingResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
      expect(res.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
      expect(res.write).toHaveBeenCalledTimes(3); // 1 transcription + 1 audio + 1 end
      expect(res.end).toHaveBeenCalled();

      // Verify chunks are valid JSON
      const parsed = res.writtenChunks.map((c: string) => JSON.parse(c.trim()));
      expect(parsed[0].type).toBe('transcription');
      expect(parsed[0].text).toBe('Hello, how are you?');
      expect(parsed[1].type).toBe('audio');
      expect(parsed[2].type).toBe('end');
    });

    it('handover pause: captures the inbound once (no double-persist) and skips the AI', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      // Once, so it can't leak into sibling tests (default stays false).
      mockChatService.isPausedForHuman.mockReturnValueOnce(true);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockStreamingResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // recordPausedInbound persists the transcript — saveUserMessage must NOT
      // also run (that was the double-persist bug that reordering fixed).
      expect(mockChatService.recordPausedInbound).toHaveBeenCalledTimes(1);
      expect(mockChatService.saveUserMessage).not.toHaveBeenCalled();
      // Caller still sees the transcription + a 'paused' chunk; no AI stream.
      const parsed = res.writtenChunks.map((c: string) => JSON.parse(c.trim()));
      expect(parsed.some((c: { type: string }) => c.type === 'transcription')).toBe(true);
      expect(parsed.some((c: { type: string }) => c.type === 'paused')).toBe(true);
      expect(mockVoiceService.streamingTTS).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalled();
    });

    it('emits a handover chunk when a voice turn escalates to a human', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.maybeEscalateToHuman.mockResolvedValueOnce(true);
      mockVoiceService.streamingTTS.mockReturnValue((async function* () {
        yield { type: 'end' as const, fullText: 'ok', totalSentences: 0 };
      })());
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue((async function* () {
        yield { type: 'item', content: 'ok' };
      })());

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockStreamingResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // The widget reads this chunk to show the "connecting" line + start polling.
      const handover = res.writtenChunks
        .map((c: string) => JSON.parse(c.trim()))
        .find((c: { type: string }) => c.type === 'handover');
      expect(handover).toBeDefined();
      expect(handover.handoverState).toBe('REQUESTED');
    });

    it('should write error chunk on streaming failure', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      // eslint-disable-next-line require-yield
      async function* failingStream(): AsyncGenerator<never> {
        throw new Error('TTS provider crashed');
      }
      mockVoiceService.streamingTTS.mockReturnValue(failingStream());
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue((async function*() {
        yield { type: 'item', content: 'Hello' };
      })());

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockStreamingResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(res.end).toHaveBeenCalled();
      // Should have written an error chunk
      const errorChunks = res.writtenChunks
        .map((c: string) => JSON.parse(c.trim()))
        .filter((c: { type: string }) => c.type === 'error');
      expect(errorChunks.length).toBe(1);
      expect(errorChunks[0].errorCode).toBeDefined();
    });

    it('should save assistant message after streaming completes', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);

      async function* mockVoiceStream() {
        yield { type: 'audio' as const, sentenceIndex: 0, text: 'Hello!', audio: 'base64audio', audioFormat: 'audio/mp3', audioDurationMs: 1000, ttsLatencyMs: 50 };
        yield { type: 'end' as const, fullText: 'Hello!', totalSentences: 1 };
      }
      mockVoiceService.streamingTTS.mockReturnValue(mockVoiceStream());
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue((async function*() {
        yield { type: 'item', content: 'Hello!' };
      })());

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest({ accept: 'application/x-ndjson' });
      const res = createMockStreamingResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        'session-123',
        'Hello!',
        expect.objectContaining({
          inputType: 'voice',
          streaming: true,
          totalSentences: 1,
          timeToFirstChunkMs: expect.any(Number),
        }),
      );
    });
  });
});
