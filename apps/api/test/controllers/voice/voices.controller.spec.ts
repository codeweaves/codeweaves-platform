import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { VoicesController } from '../../../src/modules/voice/voices.controller';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import {
  VoiceProviderError,
  UnsupportedLanguageError,
} from '../../../src/modules/voice/providers/voice-provider.interface';
import { voiceErrorCodes } from '@repo/validation';

jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((cb: (scope: { setContext: jest.Mock; setLevel: jest.Mock }) => void) => {
    cb({ setContext: jest.fn(), setLevel: jest.fn() });
  }),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

interface PreviewSuccess {
  audio: string;
  format: string;
}
interface PreviewError {
  error: boolean;
  errorCode: string;
  message: string;
}

describe('VoicesController', () => {
  let controller: VoicesController;

  const mockVoiceService = {
    listAllVoices: jest.fn(),
    previewVoice: jest.fn(),
  };

  // Minimal CurrentUserData shape — only `id` is read by the rate limiter.
  const mockUser = {
    id: 'user-123',
    auth0Id: 'auth0|abc',
    email: 'u@example.com',
    roles: [],
    role: 'CLIENT',
    organizationId: null,
    organization: null,
  } as unknown as Parameters<VoicesController['previewVoice']>[1];

  function createMockResponse(): Response {
    return { status: jest.fn().mockReturnThis() } as unknown as Response;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoicesController],
      providers: [{ provide: VoiceService, useValue: mockVoiceService }],
    }).compile();

    controller = module.get<VoicesController>(VoicesController);
    controller.clearPreviewRateLimit();
  });

  describe('GET /voices', () => {
    it('should return providers with their voices', async () => {
      mockVoiceService.listAllVoices.mockResolvedValueOnce([
        {
          provider: 'elevenlabs',
          voices: [{ id: 'el-1', name: 'Rachel', previewUrl: 'https://cdn/x.mp3' }],
        },
        {
          provider: 'sarvam',
          voices: [{ id: 'anushka', name: 'Anushka', gender: 'female' }],
        },
      ]);

      const result = await controller.listVoices();

      expect(result.providers).toHaveLength(2);
      expect(result.providers[0]?.provider).toBe('elevenlabs');
      expect(result.providers[1]?.provider).toBe('sarvam');
      expect(result.providers[0]?.voices[0]?.previewUrl).toBe('https://cdn/x.mp3');
    });

    it('should return an empty list when no providers expose a catalog', async () => {
      mockVoiceService.listAllVoices.mockResolvedValueOnce([]);
      const result = await controller.listVoices();
      expect(result.providers).toEqual([]);
    });
  });

  describe('POST /voices/preview', () => {
    const validDto = {
      provider: 'elevenlabs' as const,
      voiceId: 'voice-1',
      language: 'en' as const,
    };

    it('should return base64 audio and format on success', async () => {
      mockVoiceService.previewVoice.mockResolvedValueOnce({
        audio: Buffer.from('audio-bytes'),
        audioFormat: 'audio/mp3',
      });
      const res = createMockResponse();

      const result = (await controller.previewVoice(validDto, mockUser, res)) as PreviewSuccess;

      expect(result.format).toBe('audio/mp3');
      expect(result.audio).toBe(Buffer.from('audio-bytes').toString('base64'));
      expect(res.status).not.toHaveBeenCalled();
      expect(mockVoiceService.previewVoice).toHaveBeenCalledWith('elevenlabs', 'voice-1', 'en');
    });

    it('should map VoiceProviderError to a structured error with the provider status', async () => {
      mockVoiceService.previewVoice.mockRejectedValueOnce(
        new VoiceProviderError('elevenlabs', 'API down', HttpStatus.BAD_GATEWAY),
      );
      const res = createMockResponse();

      const result = (await controller.previewVoice(validDto, mockUser, res)) as PreviewError;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(result).toMatchObject({
        error: true,
        errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE,
      });
    });

    it('should map a 504 VoiceProviderError to PROVIDER_TIMEOUT', async () => {
      mockVoiceService.previewVoice.mockRejectedValueOnce(
        new VoiceProviderError('elevenlabs', 'timeout', HttpStatus.GATEWAY_TIMEOUT),
      );
      const res = createMockResponse();

      const result = (await controller.previewVoice(validDto, mockUser, res)) as PreviewError;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.GATEWAY_TIMEOUT);
      expect(result.errorCode).toBe(voiceErrorCodes.PROVIDER_TIMEOUT);
    });

    it('should map UnsupportedLanguageError to UNSUPPORTED_LANGUAGE / 422', async () => {
      mockVoiceService.previewVoice.mockRejectedValueOnce(
        new UnsupportedLanguageError('elevenlabs', 'gu'),
      );
      const res = createMockResponse();

      const result = (await controller.previewVoice(validDto, mockUser, res)) as PreviewError;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(result.errorCode).toBe(voiceErrorCodes.UNSUPPORTED_LANGUAGE);
    });

    it('should map unknown errors to TTS_FAILED / 422', async () => {
      mockVoiceService.previewVoice.mockRejectedValueOnce(new Error('boom'));
      const res = createMockResponse();

      const result = (await controller.previewVoice(validDto, mockUser, res)) as PreviewError;

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(result.errorCode).toBe(voiceErrorCodes.TTS_FAILED);
    });
  });

  describe('rate limit (60 per user per minute)', () => {
    const validDto = {
      provider: 'elevenlabs' as const,
      voiceId: 'voice-1',
      language: 'en' as const,
    };

    beforeEach(() => {
      mockVoiceService.previewVoice.mockResolvedValue({
        audio: Buffer.from('a'),
        audioFormat: 'audio/ogg',
      });
    });

    it('should allow up to 60 previews from one user, then 429 on the 61st', async () => {
      const res = createMockResponse();
      for (let i = 0; i < 60; i++) {
        const r = (await controller.previewVoice(validDto, mockUser, res)) as PreviewSuccess;
        expect(r.format).toBe('audio/ogg');
      }

      const blocked = (await controller.previewVoice(validDto, mockUser, res)) as PreviewError & {
        retryAfterSeconds: number;
      };
      expect(res.status).toHaveBeenLastCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(blocked.errorCode).toBe(voiceErrorCodes.RATE_LIMITED);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(mockVoiceService.previewVoice).toHaveBeenCalledTimes(60);
    });

    it('should track buckets per user — one user being rate-limited does not block another', async () => {
      const otherUser = { ...mockUser, id: 'other-user' } as typeof mockUser;
      const res = createMockResponse();

      for (let i = 0; i < 60; i++) {
        await controller.previewVoice(validDto, mockUser, res);
      }
      // mockUser is now exhausted; otherUser must still be allowed
      const result = (await controller.previewVoice(validDto, otherUser, res)) as PreviewSuccess;
      expect(result.format).toBe('audio/ogg');
    });
  });
});
