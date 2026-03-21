import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { DeepgramProvider } from '../../../src/modules/voice/providers/deepgram.provider';
import {
  VoiceProviderError,
  type STTRequest,
  type TTSRequest,
} from '../../../src/modules/voice/providers/voice-provider.interface';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('DeepgramProvider', () => {
  let provider: DeepgramProvider;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'DEEPGRAM_API_KEY') return 'test-deepgram-key';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepgramProvider,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    provider = module.get<DeepgramProvider>(DeepgramProvider);
  });

  describe('provider metadata', () => {
    it('should have name "deepgram"', () => {
      expect(provider.name).toBe('deepgram');
    });

    it('should support expected languages', () => {
      expect(provider.supportedLanguages).toEqual(
        expect.arrayContaining(['en', 'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn']),
      );
      expect(provider.supportedLanguages).toHaveLength(8);
    });
  });

  describe('transcribe (STT)', () => {
    const sttRequest: STTRequest = {
      audio: Buffer.from('test-audio-data'),
      audioFormat: 'audio/webm',
      languageHint: 'hi',
      agentId: 'agent-123',
    };

    const mockDeepgramResponse = {
      metadata: {
        request_id: 'req-1',
        duration: 2.5,
        channels: 1,
        models: ['nova-3'],
      },
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'नमस्ते दुनिया',
                confidence: 0.97,
                words: [],
              },
            ],
            detected_language: 'hi',
          },
        ],
      },
    };

    it('should parse successful STT response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      const result = await provider.transcribe(sttRequest);

      expect(result.transcript).toBe('नमस्ते दुनिया');
      expect(result.confidence).toBe(0.97);
      expect(result.detectedLanguage).toBe('hi');
      expect(result.provider).toBe('deepgram');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should use auth header with Token prefix (not Bearer)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe(sttRequest);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['Authorization']).toBe('Token test-deepgram-key');
    });

    it('should send raw binary body (not FormData)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe(sttRequest);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(callArgs.body)).toEqual(sttRequest.audio);
    });

    it('should set correct URL with query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe(sttRequest);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('https://api.deepgram.com/v1/listen');
      expect(url).toContain('model=nova-3');
      expect(url).toContain('language=hi');
      expect(url).toContain('smart_format=true');
      expect(url).toContain('punctuate=true');
    });

    it('should default to "en" when no languageHint provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe({
        ...sttRequest,
        languageHint: undefined,
      });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('language=en');
    });

    it('should set Content-Type for webm format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe(sttRequest);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('audio/webm');
    });

    it('should set Content-Type for wav format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe({
        ...sttRequest,
        audioFormat: 'audio/wav',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('audio/wav');
    });

    it('should set Content-Type for mp3 format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe({
        ...sttRequest,
        audioFormat: 'mp3',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('audio/mp3');
    });

    it('should default Content-Type to audio/webm for unknown format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe({
        ...sttRequest,
        audioFormat: 'unknown-format',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('audio/webm');
    });

    it('should include AbortSignal for timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockDeepgramResponse,
      });

      await provider.transcribe(sttRequest);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('synthesize (TTS)', () => {
    it('should throw VoiceProviderError for non-English languages', async () => {
      const ttsRequest: TTSRequest = {
        text: 'नमस्ते',
        language: 'hi',
        agentId: 'agent-123',
      };

      try {
        await provider.synthesize(ttsRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((e as VoiceProviderError).message).toContain('Deepgram TTS is not implemented');
      }
    });

    it('should throw VoiceProviderError even for English (TTS not implemented)', async () => {
      const ttsRequest: TTSRequest = {
        text: 'Hello world',
        language: 'en',
        agentId: 'agent-123',
      };

      try {
        await provider.synthesize(ttsRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('detectLanguage', () => {
    it('should use language=multi for auto-detection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: { request_id: 'req-1', duration: 2, channels: 1, models: ['nova-3'] },
          results: {
            channels: [
              {
                alternatives: [{ transcript: 'test', confidence: 0.92, words: [] }],
                detected_language: 'ta',
              },
            ],
          },
        }),
      });

      const result = await provider.detectLanguage(
        Buffer.from('test-audio'),
        'audio/webm',
      );

      expect(result.detectedLanguage).toBe('ta');
      expect(result.confidence).toBe(0.92);
      expect(result.provider).toBe('deepgram');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('language=multi');
    });

    it('should default to "en" when no detected_language in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          metadata: { request_id: 'req-1', duration: 2, channels: 1, models: ['nova-3'] },
          results: {
            channels: [
              {
                alternatives: [{ transcript: 'hello', confidence: 0.95, words: [] }],
              },
            ],
          },
        }),
      });

      const result = await provider.detectLanguage(
        Buffer.from('test-audio'),
        'audio/webm',
      );

      expect(result.detectedLanguage).toBe('en');
    });
  });

  describe('error handling', () => {
    const sttRequest: STTRequest = {
      audio: Buffer.from('test'),
      audioFormat: 'audio/webm',
      agentId: 'agent-123',
    };

    it('should map 401 to UNAUTHORIZED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          err_code: 'INVALID_AUTH',
          err_msg: 'Invalid credentials',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      }
    });

    it('should map 429 to TOO_MANY_REQUESTS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          err_code: 'RATE_LIMIT',
          err_msg: 'Rate limit exceeded',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should map 400 to BAD_REQUEST', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          err_code: 'BAD_REQUEST',
          err_msg: 'Invalid audio format',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it('should map 500 to BAD_GATEWAY', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          err_code: 'INTERNAL_ERROR',
          err_msg: 'Internal error',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it('should map 502 to BAD_GATEWAY', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({
          err_code: 'BAD_GATEWAY',
          err_msg: 'Bad gateway',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it('should map 503 to BAD_GATEWAY', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          err_code: 'SERVICE_UNAVAILABLE',
          err_msg: 'Service unavailable',
          request_id: 'req-1',
        }),
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new DOMException('The operation was aborted', 'TimeoutError');
      mockFetch.mockRejectedValueOnce(timeoutError);

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
        expect((e as VoiceProviderError).message).toContain('timed out');
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => { throw new Error('not json'); },
      });

      try {
        await provider.transcribe(sttRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });
  });

  describe('missing API key', () => {
    it('should create provider with empty API key without crashing', async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(''),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeepgramProvider,
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const p = module.get<DeepgramProvider>(DeepgramProvider);
      expect(p.name).toBe('deepgram');
    });
  });
});
