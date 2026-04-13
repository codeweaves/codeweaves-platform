import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { VoiceController } from '../../../src/modules/voice/voice.controller';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import { ChatService } from '../../../src/services/chat.service';
import { N8nStreamingService } from '../../../src/services/n8n-streaming.service';
import { AgentsService } from '../../../src/services/agents.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';
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

interface ConversationResult {
  transcription: { text: string; detectedLanguage: string; confidence: number };
  response: { text: string; audio: string | null; audioFormat: string | null; audioDurationMs: number | null };
  sessionId: string;
  messageId: string;
  metrics: { sttLatencyMs: number; aiLatencyMs: number; ttsLatencyMs: number; totalLatencyMs: number };
  ttsError?: { errorCode: string; message: string };
}

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
  };

  const mockMessageRateLimitService = {
    checkMessageRateLimit: jest.fn(),
    getDeviceIdentifier: jest.fn(),
  };

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: ChatService, useValue: mockChatService },
        { provide: N8nStreamingService, useValue: mockN8nStreamingService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MessageRateLimitService, useValue: mockMessageRateLimitService },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);

    // Default: resolve agent (publicId → UUID)
    mockChatService.resolveAgent.mockResolvedValue({ id: AGENT_ID, hmacEnabled: false });

    // Default: rate limit allowed
    mockMessageRateLimitService.getDeviceIdentifier.mockReturnValue('test-device');
    mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({ allowed: true });

    // Default: no webhook URL → legacy sequential path
    mockAgentsService.getEffectiveWebhookUrl.mockRejectedValue(new Error('No webhook URL'));

    // Default: prisma mocks
    mockPrismaService.chatMessage.update.mockResolvedValue({});

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
  // POST /voice/conversation
  // ============================
  describe('voiceConversation', () => {
    it('should complete full STT → Chat → TTS flow and return all fields', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      expect(result.transcription).toEqual({
        text: 'Hello, how are you?',
        detectedLanguage: 'en',
        confidence: 0.95,
      });
      expect(result.response.text).toBe('I am doing great, thanks!');
      expect(result.response.audio).toBe(mockTtsResult.audio.toString('base64'));
      expect(result.response.audioFormat).toBe('audio/mp3');
      expect(result.response.audioDurationMs).toBe(2000);
      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.messageId).toBe('msg-uuid');
      expect(result.metrics).toHaveProperty('sttLatencyMs');
      expect(result.metrics).toHaveProperty('aiLatencyMs');
      expect(result.metrics).toHaveProperty('ttsLatencyMs');
      expect(result.metrics).toHaveProperty('totalLatencyMs');
      expect(result.ttsError).toBeUndefined();
    });

    it('should skip TTS and return audio: null when ttsEnabled is false', async () => {
      mockVoiceService.getVoiceConfig.mockResolvedValue({
        sttEnabled: true,
        ttsEnabled: false,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        ttsSpeed: 1.0,
        autoDetectLanguage: true,
      });
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      expect(result.response.audio).toBeNull();
      expect(result.response.audioFormat).toBeNull();
      expect(result.response.audioDurationMs).toBeNull();
      expect(result.metrics.ttsLatencyMs).toBe(0);
      expect(mockVoiceService.synthesize).not.toHaveBeenCalled();
    });

    it('should pass transcribed text to chatService.sendMessage', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        chatInput: 'Hello, how are you?',
        sessionId: SESSION_ID,
        source: 'WIDGET',
      });
    });

    it('should pass STT detected language to TTS synthesis', async () => {
      const hiSttResult = { ...mockSttResult, detectedLanguage: 'hi' as const };
      mockVoiceService.transcribe.mockResolvedValue(hiSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(mockVoiceService.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'hi' }),
      );
    });

    it('should calculate metrics correctly', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      const { metrics } = result;
      expect(typeof metrics.sttLatencyMs).toBe('number');
      expect(typeof metrics.aiLatencyMs).toBe('number');
      expect(typeof metrics.ttsLatencyMs).toBe('number');
      expect(typeof metrics.totalLatencyMs).toBe('number');
      expect(metrics.totalLatencyMs).toBeGreaterThanOrEqual(
        metrics.sttLatencyMs + metrics.aiLatencyMs + metrics.ttsLatencyMs,
      );
    });

    it('should return rate limit error with RATE_LIMITED errorCode', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result).toEqual({
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockVoiceService.transcribe).not.toHaveBeenCalled();
    });

    it('should always derive deviceId from request, ignoring dto.deviceId', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, deviceId: 'attacker-supplied-id' };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(mockMessageRateLimitService.getDeviceIdentifier).toHaveBeenCalledWith(req);
      expect(mockMessageRateLimitService.checkMessageRateLimit).toHaveBeenCalledWith(
        'test-device',
        AGENT_ID,
      );
    });

    it('should return AUDIO_TOO_SHORT error when STT returns empty transcript', async () => {
      mockVoiceService.transcribe.mockResolvedValue({
        ...mockSttResult,
        transcript: '   ',
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.AUDIO_TOO_SHORT);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip TTS when chatResult.reply is empty', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue({ ...mockChatResult, reply: '' });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      expect(result.response.audio).toBeNull();
      expect(mockVoiceService.synthesize).not.toHaveBeenCalled();
    });
  });

  // ============================
  // Voice metadata storage (Story 10-14)
  // ============================
  describe('voice metadata storage', () => {
    it('should store voice metadata on user message after successful conversation', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // User message metadata — includes aiLatencyMs (P3) and defensive spread (P4)
      expect(mockPrismaService.chatMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-uuid' },
          data: {
            metadata: expect.objectContaining({
              inputType: 'voice',
              detectedLanguage: 'en',
              languageConfidence: 0.95,
              sttProvider: 'deepgram',
              aiLatencyMs: expect.any(Number),
            }),
          },
        }),
      );
    });

    it('should store TTS provider metadata on assistant message', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // Assistant message metadata — ttsError key omitted when no error (P1)
      const assistantCall = mockPrismaService.chatMessage.update.mock.calls.find(
        (call: [{ where: { id: string }; data: { metadata: Record<string, unknown> } }]) => call[0].where.id === 'assistant-msg-uuid',
      );
      expect(assistantCall).toBeDefined();
      const assistantMeta = assistantCall![0].data.metadata as Record<string, unknown>;
      expect(assistantMeta.inputType).toBe('voice');
      expect(assistantMeta.ttsProvider).toBe('elevenlabs');
      expect(assistantMeta).not.toHaveProperty('ttsError');
    });

    it('should store ttsError code in assistant metadata when TTS fails', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'TTS failed'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // Assistant message should have ttsError
      expect(mockPrismaService.chatMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'assistant-msg-uuid' },
          data: {
            metadata: expect.objectContaining({
              ttsError: voiceErrorCodes.TTS_FAILED,
            }),
          },
        }),
      );
    });

    it('should not fail the response if metadata storage fails (retries once)', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);
      mockPrismaService.chatMessage.update.mockRejectedValue(new Error('DB error'));

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      // Fire-and-forget: allow retry to complete
      await new Promise((r) => setTimeout(r, 50));

      // Should still return successful response
      expect(result.transcription.text).toBe('Hello, how are you?');
      expect(result.response.text).toBe('I am doing great, thanks!');
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

    it('should return text-only response with ttsError when TTS fails (graceful degradation)', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'API returned 500'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      // Should NOT be an error response — should be a successful response with text
      expect(result.transcription.text).toBe('Hello, how are you?');
      expect(result.response.text).toBe('I am doing great, thanks!');
      expect(result.response.audio).toBeNull();
      expect(result.response.audioFormat).toBeNull();
      expect(result.ttsError).toEqual({
        errorCode: voiceErrorCodes.TTS_FAILED,
        message: 'Voice playback unavailable',
      });
      // Should NOT set error HTTP status — this is a 200 with degraded response
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return text-only response when TTS fallback chain is exhausted (not 500)', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('sarvam', 'No TTS provider supports language: mr', HttpStatus.BAD_GATEWAY),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      // AC #11: TTS fallback exhausted should return text-only, NOT a 500
      expect(result.response.text).toBe('I am doing great, thanks!');
      expect(result.response.audio).toBeNull();
      expect(result.ttsError).toBeDefined();
      expect(result.ttsError!.errorCode).toBe(voiceErrorCodes.TTS_FAILED);
    });

    it('should return PROVIDER_UNAVAILABLE error when chatService fails', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockRejectedValue(new Error('n8n webhook down'));

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ErrorResult;

      expect(result.error).toBe(true);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_UNAVAILABLE);
      expect(result.message).toBe('AI service temporarily unavailable');
      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    });

    it('should default to TTS enabled when getVoiceConfig fails', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.getVoiceConfig.mockRejectedValue(new Error('DB connection lost'));
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      // Should still attempt TTS since default is ttsEnabled: true
      expect(mockVoiceService.synthesize).toHaveBeenCalled();
      expect(result.response.audio).toBe(mockTtsResult.audio.toString('base64'));
    });

    it('should report STT errors to Sentry with voice context', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('deepgram', 'API failure'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, languageHint: 'hi' as const };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(Sentry.withScope).toHaveBeenCalled();
    });

    it('should report TTS errors to Sentry as warning (graceful degradation)', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'TTS failed'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      // Sentry should be called for TTS failure
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

    it('should fall back to legacy path when webhookUrl is not available', async () => {
      mockAgentsService.getEffectiveWebhookUrl.mockRejectedValue(new Error('No webhook'));
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      const result = await controller.voiceConversation(audioFile, dto, req, res) as ConversationResult;

      expect(result.transcription).toBeDefined();
      expect(result.response.text).toBe('I am doing great, thanks!');
      expect(mockChatService.sendMessage).toHaveBeenCalled();
    });

    it('should fall back to legacy path when TTS is disabled', async () => {
      mockVoiceService.getVoiceConfig.mockResolvedValue({ ttsEnabled: false });
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.voiceConversation(audioFile, dto, req, res);

      expect(mockN8nStreamingService.streamFromWebhookUrl).not.toHaveBeenCalled();
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
