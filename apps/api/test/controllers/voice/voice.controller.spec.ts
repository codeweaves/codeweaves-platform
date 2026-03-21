import { Test, TestingModule } from '@nestjs/testing';
import { VoiceController } from '../../../src/modules/voice/voice.controller';
import { VoiceService } from '../../../src/modules/voice/voice.service';

describe('VoiceController', () => {
  let controller: VoiceController;

  const mockVoiceService = {
    getRegisteredProviders: jest.fn(),
    transcribe: jest.fn(),
    synthesize: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: VoiceService, useValue: mockVoiceService },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);
  });

  describe('getProviders', () => {
    it('should return list of registered providers', () => {
      mockVoiceService.getRegisteredProviders.mockReturnValue(['stub', 'sarvam']);

      const result = controller.getProviders();

      expect(result).toEqual({ providers: ['stub', 'sarvam'] });
      expect(mockVoiceService.getRegisteredProviders).toHaveBeenCalledTimes(1);
    });

    it('should return empty list when no providers registered', () => {
      mockVoiceService.getRegisteredProviders.mockReturnValue([]);

      const result = controller.getProviders();

      expect(result).toEqual({ providers: [] });
    });
  });

  describe('transcribe', () => {
    it('should delegate to VoiceService.transcribe', async () => {
      const dto = { agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', languageHint: 'hi' as const };
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'hello',
        detectedLanguage: 'hi',
        provider: 'stub',
        confidence: 0.95,
        latencyMs: 1,
      });

      const result = await controller.transcribe(dto);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith({
        audio: expect.any(Buffer),
        audioFormat: 'audio/webm',
        languageHint: 'hi',
        agentId: dto.agentId,
      });
      expect(result).toEqual({
        transcript: 'hello',
        detectedLanguage: 'hi',
        provider: 'stub',
      });
    });

    it('should pass undefined languageHint when not provided', async () => {
      const dto = { agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' };
      mockVoiceService.transcribe.mockResolvedValue({
        transcript: 'hello',
        detectedLanguage: 'en',
        provider: 'stub',
        confidence: 0.95,
        latencyMs: 1,
      });

      await controller.transcribe(dto);

      expect(mockVoiceService.transcribe).toHaveBeenCalledWith(expect.objectContaining({
        languageHint: undefined,
      }));
    });
  });

  describe('synthesize', () => {
    it('should delegate to VoiceService.synthesize', async () => {
      const dto = {
        text: 'Hello world',
        language: 'en' as const,
        agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      };
      mockVoiceService.synthesize.mockResolvedValue({
        audio: Buffer.from('audio-data'),
        audioFormat: 'audio/mp3',
        durationMs: 1000,
        provider: 'stub',
        latencyMs: 1,
      });

      const result = await controller.synthesize(dto);

      expect(mockVoiceService.synthesize).toHaveBeenCalledWith({
        text: 'Hello world',
        language: 'en',
        voiceId: undefined,
        speed: undefined,
        agentId: dto.agentId,
      });
      expect(result).toEqual({
        audioFormat: 'audio/mp3',
        durationMs: 1000,
        provider: 'stub',
      });
    });

    it('should pass optional voiceId and speed when provided', async () => {
      const dto = {
        text: 'Namaste',
        language: 'hi' as const,
        voiceId: 'voice-123',
        speed: 1.5,
        agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      };
      mockVoiceService.synthesize.mockResolvedValue({
        audio: Buffer.from('audio-data'),
        audioFormat: 'audio/mp3',
        durationMs: 800,
        provider: 'stub',
        latencyMs: 1,
      });

      await controller.synthesize(dto);

      expect(mockVoiceService.synthesize).toHaveBeenCalledWith(expect.objectContaining({
        voiceId: 'voice-123',
        speed: 1.5,
      }));
    });
  });
});
