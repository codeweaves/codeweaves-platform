import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import { StubProvider } from '../../../src/modules/voice/providers/stub.provider';
import {
  VOICE_PROVIDERS,
  type VoiceProvider,
  type STTRequest,
  type TTSRequest,
  VoiceProviderError,
} from '../../../src/modules/voice/providers/voice-provider.interface';

describe('VoiceService', () => {
  let service: VoiceService;
  let stubProvider: StubProvider;

  beforeEach(async () => {
    stubProvider = new StubProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        {
          provide: VOICE_PROVIDERS,
          useValue: [stubProvider],
        },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
  });

  describe('provider registry', () => {
    it('should register providers on construction', () => {
      const providers = service.getRegisteredProviders();
      expect(providers).toContain('stub');
    });

    it('should return a registered provider by name', () => {
      const provider = service.getProvider('stub');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('stub');
    });

    it('should throw BadRequestException for unknown provider', () => {
      expect(() => service.getProvider('nonexistent')).toThrow(BadRequestException);
      expect(() => service.getProvider('nonexistent')).toThrow('Unknown voice provider: "nonexistent"');
    });

    it('should list all registered provider names', () => {
      const providers = service.getRegisteredProviders();
      expect(providers).toEqual(['stub']);
    });

    it('should register multiple providers', async () => {
      const mockProvider: VoiceProvider = {
        name: 'mock-extra',
        supportedLanguages: ['en'],
        transcribe: jest.fn(),
        synthesize: jest.fn(),
        detectLanguage: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VoiceService,
          {
            provide: VOICE_PROVIDERS,
            useValue: [stubProvider, mockProvider],
          },
        ],
      }).compile();

      const svc = module.get<VoiceService>(VoiceService);
      expect(svc.getRegisteredProviders()).toEqual(['stub', 'mock-extra']);
    });
  });

  describe('routing logic', () => {
    it('should delegate transcribe to the correct provider', async () => {
      const request: STTRequest = {
        audio: Buffer.from('test-audio'),
        audioFormat: 'audio/webm',
        agentId: 'agent-123',
      };

      const spy = jest.spyOn(stubProvider, 'transcribe');
      const result = await service.transcribe('stub', request);

      expect(spy).toHaveBeenCalledWith(request);
      expect(result.provider).toBe('stub');
      expect(result.transcript).toBeDefined();
    });

    it('should delegate synthesize to the correct provider', async () => {
      const request: TTSRequest = {
        text: 'Hello world',
        language: 'en',
        agentId: 'agent-123',
      };

      const spy = jest.spyOn(stubProvider, 'synthesize');
      const result = await service.synthesize('stub', request);

      expect(spy).toHaveBeenCalledWith(request);
      expect(result.provider).toBe('stub');
      expect(result.audio).toBeDefined();
    });

    it('should delegate detectLanguage to the correct provider', async () => {
      const audio = Buffer.from('test-audio');

      const spy = jest.spyOn(stubProvider, 'detectLanguage');
      const result = await service.detectLanguage('stub', audio, 'audio/webm');

      expect(spy).toHaveBeenCalledWith(audio, 'audio/webm');
      expect(result.provider).toBe('stub');
      expect(result.detectedLanguage).toBeDefined();
    });

    it('should throw when routing to unknown provider for transcribe', async () => {
      const request: STTRequest = {
        audio: Buffer.from('test'),
        audioFormat: 'audio/webm',
        agentId: 'agent-123',
      };

      await expect(service.transcribe('unknown', request)).rejects.toThrow(BadRequestException);
    });

    it('should throw when routing to unknown provider for synthesize', async () => {
      const request: TTSRequest = {
        text: 'Hello',
        language: 'en',
        agentId: 'agent-123',
      };

      await expect(service.synthesize('unknown', request)).rejects.toThrow(BadRequestException);
    });

    it('should throw when routing to unknown provider for detectLanguage', async () => {
      await expect(
        service.detectLanguage('unknown', Buffer.from('test'), 'audio/webm'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('stub provider responses', () => {
    it('should return valid STTResponse from stub', async () => {
      const request: STTRequest = {
        audio: Buffer.from('test-audio'),
        audioFormat: 'audio/webm',
        languageHint: 'hi',
        agentId: 'agent-123',
      };

      const result = await service.transcribe('stub', request);

      expect(result).toMatchObject({
        transcript: expect.any(String),
        confidence: expect.any(Number),
        detectedLanguage: 'hi',
        provider: 'stub',
        latencyMs: expect.any(Number),
      });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should default to "en" when no language hint provided', async () => {
      const request: STTRequest = {
        audio: Buffer.from('test-audio'),
        audioFormat: 'audio/webm',
        agentId: 'agent-123',
      };

      const result = await service.transcribe('stub', request);
      expect(result.detectedLanguage).toBe('en');
    });

    it('should return valid TTSResponse from stub', async () => {
      const request: TTSRequest = {
        text: 'Hello world',
        language: 'en',
        agentId: 'agent-123',
      };

      const result = await service.synthesize('stub', request);

      expect(result).toMatchObject({
        audio: expect.any(Buffer),
        audioFormat: 'audio/mp3',
        durationMs: expect.any(Number),
        provider: 'stub',
        latencyMs: expect.any(Number),
      });
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it('should return valid LanguageDetectionResponse from stub', async () => {
      const result = await service.detectLanguage('stub', Buffer.from('test'), 'audio/webm');

      expect(result).toMatchObject({
        detectedLanguage: expect.any(String),
        confidence: expect.any(Number),
        provider: 'stub',
        latencyMs: expect.any(Number),
      });
    });
  });

  describe('VoiceProviderError', () => {
    it('should create error with provider name in message', () => {
      const error = new VoiceProviderError('sarvam', 'API key invalid');
      expect(error.message).toBe('[sarvam] API key invalid');
      expect(error.provider).toBe('sarvam');
      expect(error.getStatus()).toBe(502);
    });

    it('should support custom HTTP status', () => {
      const error = new VoiceProviderError('deepgram', 'Bad format', 400);
      expect(error.getStatus()).toBe(400);
    });

    it('should support original error', () => {
      const original = new Error('network timeout');
      const error = new VoiceProviderError('elevenlabs', 'Connection failed', 502, original);
      expect(error.originalError).toBe(original);
    });
  });
});
