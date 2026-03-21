import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { VoiceController } from '../../../src/modules/voice/voice.controller';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import { ChatService } from '../../../src/services/chat.service';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
} from '../../../src/modules/voice/providers/voice-provider.interface';

interface ConversationResult {
  transcription: { text: string; detectedLanguage: string; confidence: number };
  response: { text: string; audio: string | null; audioFormat: string | null; audioDurationMs: number | null };
  sessionId: string;
  messageId: string;
  metrics: { sttLatencyMs: number; aiLatencyMs: number; ttsLatencyMs: number; totalLatencyMs: number };
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
  };

  const mockChatService = {
    sendMessage: jest.fn(),
  };

  const mockMessageRateLimitService = {
    checkMessageRateLimit: jest.fn(),
    getDeviceIdentifier: jest.fn(),
  };

  function createMockRequest(): Request {
    return {
      headers: { 'x-device-id': 'test-device' },
      ip: '127.0.0.1',
    } as unknown as Request;
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
        { provide: MessageRateLimitService, useValue: mockMessageRateLimitService },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);

    // Default: rate limit allowed
    mockMessageRateLimitService.getDeviceIdentifier.mockReturnValue('test-device');
    mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({ allowed: true });

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

      const result = await controller.voiceConversation(audioFile, dto, req) as ConversationResult;

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

      const result = await controller.voiceConversation(audioFile, dto, req);

      const res = result as ConversationResult;
      expect(res.response.audio).toBeNull();
      expect(res.response.audioFormat).toBeNull();
      expect(res.response.audioDurationMs).toBeNull();
      expect(res.metrics.ttsLatencyMs).toBe(0);
      expect(mockVoiceService.synthesize).not.toHaveBeenCalled();
    });

    it('should pass transcribed text to chatService.sendMessage', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, sessionId: SESSION_ID };
      const req = createMockRequest();

      await controller.voiceConversation(audioFile, dto, req);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        chatInput: 'Hello, how are you?',
        sessionId: SESSION_ID,
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

      await controller.voiceConversation(audioFile, dto, req);

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

      const result = await controller.voiceConversation(audioFile, dto, req) as ConversationResult;

      const { metrics } = result;
      expect(typeof metrics.sttLatencyMs).toBe('number');
      expect(typeof metrics.aiLatencyMs).toBe('number');
      expect(typeof metrics.ttsLatencyMs).toBe('number');
      expect(typeof metrics.totalLatencyMs).toBe('number');
      expect(metrics.totalLatencyMs).toBeGreaterThanOrEqual(
        metrics.sttLatencyMs + metrics.aiLatencyMs + metrics.ttsLatencyMs,
      );
    });

    it('should return rate limit error when rate limited', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      const result = await controller.voiceConversation(audioFile, dto, req);

      expect(result).toEqual({
        error: true,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      expect(mockVoiceService.transcribe).not.toHaveBeenCalled();
    });

    it('should always derive deviceId from request, ignoring dto.deviceId', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID, deviceId: 'attacker-supplied-id' };
      const req = createMockRequest();

      await controller.voiceConversation(audioFile, dto, req);

      expect(mockMessageRateLimitService.getDeviceIdentifier).toHaveBeenCalledWith(req);
      expect(mockMessageRateLimitService.checkMessageRateLimit).toHaveBeenCalledWith(
        'test-device',
        AGENT_ID,
      );
    });

    it('should throw 400 when STT returns empty transcript', async () => {
      mockVoiceService.transcribe.mockResolvedValue({
        ...mockSttResult,
        transcript: '   ',
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(BadRequestException);
      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip TTS when chatResult.reply is empty', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue({ ...mockChatResult, reply: '' });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      const result = await controller.voiceConversation(audioFile, dto, req) as ConversationResult;

      expect(result.response.audio).toBeNull();
      expect(mockVoiceService.synthesize).not.toHaveBeenCalled();
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

      const result = await controller.transcribe(audioFile, dto, req);

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

      await controller.transcribe(audioFile, dto, req);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith({
        audio: audioFile.buffer,
        audioFormat: 'audio/wav',
        languageHint: undefined,
        agentId: AGENT_ID,
      });
    });

    it('should return rate limit error when rate limited', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 30,
      });

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      const result = await controller.transcribe(audioFile, dto, req);

      expect(result).toEqual({
        error: true,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 30,
      });
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

      const result = await controller.synthesize(dto, req);

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

      await controller.synthesize(dto, req);

      expect(mockVoiceService.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: 'voice-123',
          speed: 1.5,
        }),
      );
    });

    it('should return rate limit error when rate limited', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You've sent too many messages. Please try again later.",
        retryAfterSeconds: 60,
      });

      const dto = { text: 'Hello', language: 'en' as const, agentId: AGENT_ID };
      const req = createMockRequest();

      const result = await controller.synthesize(dto, req);

      expect(result).toEqual({
        error: true,
        message: "You've sent too many messages. Please try again later.",
        retryAfterSeconds: 60,
      });
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
    it('should throw 400 when no audio file provided', async () => {
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(undefined as unknown as Express.Multer.File, dto, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 for invalid MIME type', async () => {
      const audioFile = createMockAudioFile({ mimetype: 'application/pdf' });
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 when no audio file on transcribe endpoint', async () => {
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.transcribe(undefined as unknown as Express.Multer.File, dto, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept all valid audio MIME types', async () => {
      const validMimes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg'];

      for (const mimetype of validMimes) {
        mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
        mockChatService.sendMessage.mockResolvedValue(mockChatResult);
        mockVoiceService.synthesize.mockResolvedValue(mockTtsResult);

        const audioFile = createMockAudioFile({ mimetype });
        const dto = { agentId: AGENT_ID };
        const req = createMockRequest();

        // Should not throw
        await expect(
          controller.voiceConversation(audioFile, dto, req),
        ).resolves.toBeDefined();
      }
    });
  });

  // ============================
  // Error handling
  // ============================
  describe('error handling', () => {
    it('should return 422 for UnsupportedLanguageError', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new UnsupportedLanguageError('deepgram', 'unknown-lang'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
      );
    });

    it('should return 504 for provider timeout errors', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('deepgram', 'Request timed out after 10s', HttpStatus.GATEWAY_TIMEOUT),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.GATEWAY_TIMEOUT,
        }),
      );
    });

    it('should return 502 for general provider errors', async () => {
      mockVoiceService.transcribe.mockRejectedValue(
        new VoiceProviderError('sarvam', 'API returned 500'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_GATEWAY,
        }),
      );
    });

    it('should rethrow non-provider errors', async () => {
      mockVoiceService.transcribe.mockRejectedValue(new Error('Unexpected error'));

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow('Unexpected error');
    });

    it('should handle TTS provider error in conversation flow', async () => {
      mockVoiceService.transcribe.mockResolvedValue(mockSttResult);
      mockChatService.sendMessage.mockResolvedValue(mockChatResult);
      mockVoiceService.synthesize.mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'API returned 500'),
      );

      const audioFile = createMockAudioFile();
      const dto = { agentId: AGENT_ID };
      const req = createMockRequest();

      await expect(
        controller.voiceConversation(audioFile, dto, req),
      ).rejects.toThrow(HttpException);
    });
  });
});
