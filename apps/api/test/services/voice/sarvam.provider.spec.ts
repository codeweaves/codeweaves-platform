import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { SarvamProvider } from '../../../src/modules/voice/providers/sarvam.provider';
import { ProviderEventLogger } from '../../../src/common/events/provider.logger';
import {
  VoiceProviderError,
  type STTRequest,
  type TTSRequest,
  type SupportedLanguage,
} from '../../../src/modules/voice/providers/voice-provider.interface';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ProviderEventLogger mock. `traced` is a PLAIN arrow (not jest.fn) so its
// passthrough impl survives jest.config `resetMocks: true`.
const mockProviderLog = {
  traced: <T,>(_opts: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  log: jest.fn(),
};

describe('SarvamProvider', () => {
  let provider: SarvamProvider;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'SARVAM_API_KEY') return 'test-sarvam-key';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SarvamProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ProviderEventLogger, useValue: mockProviderLog },
      ],
    }).compile();

    provider = module.get<SarvamProvider>(SarvamProvider);
  });

  describe('provider metadata', () => {
    it('should have name "sarvam"', () => {
      expect(provider.name).toBe('sarvam');
    });

    it('should support all Indian languages plus English and Hinglish', () => {
      expect(provider.supportedLanguages).toContain('hi');
      expect(provider.supportedLanguages).toContain('mr');
      expect(provider.supportedLanguages).toContain('bn');
      expect(provider.supportedLanguages).toContain('ta');
      expect(provider.supportedLanguages).toContain('te');
      expect(provider.supportedLanguages).toContain('gu');
      expect(provider.supportedLanguages).toContain('kn');
      expect(provider.supportedLanguages).toContain('ml');
      expect(provider.supportedLanguages).toContain('pa');
      expect(provider.supportedLanguages).toContain('or');
      expect(provider.supportedLanguages).toContain('en');
      expect(provider.supportedLanguages).toContain('hinglish');
    });
  });

  describe('transcribe (STT)', () => {
    const sttRequest: STTRequest = {
      audio: Buffer.from('test-audio-data'),
      audioFormat: 'audio/webm',
      languageHint: 'hi',
      agentId: 'agent-123',
    };

    it('should parse successful STT response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          transcript: 'नमस्ते दुनिया',
          language_code: 'hi-IN',
          language_probability: 0.95,
          timestamps: null,
        }),
      });

      const result = await provider.transcribe(sttRequest);

      expect(result.transcript).toBe('नमस्ते दुनिया');
      expect(result.confidence).toBe(0.95);
      expect(result.detectedLanguage).toBe('hi');
      expect(result.provider).toBe('sarvam');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should send correct headers and FormData', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'test',
          language_code: 'hi-IN',
          language_probability: 0.9,
          timestamps: null,
        }),
      });

      await provider.transcribe(sttRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sarvam.ai/speech-to-text',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'api-subscription-key': 'test-sarvam-key',
          }),
          signal: expect.any(AbortSignal),
        }),
      );

      // Verify FormData is sent as body
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBeInstanceOf(FormData);
    });

    it('should map language hint to Sarvam BCP-47 format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'test',
          language_code: 'mr-IN',
          language_probability: 0.85,
          timestamps: null,
        }),
      });

      const mrRequest: STTRequest = {
        ...sttRequest,
        languageHint: 'mr',
      };

      const result = await provider.transcribe(mrRequest);
      expect(result.detectedLanguage).toBe('mr');
    });

    it('should handle null language_probability', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'test',
          language_code: 'en-IN',
          language_probability: null,
          timestamps: null,
        }),
      });

      const result = await provider.transcribe(sttRequest);
      expect(result.confidence).toBe(0);
    });

    it('should handle null language_code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'test',
          language_code: null,
          language_probability: null,
          timestamps: null,
        }),
      });

      const result = await provider.transcribe(sttRequest);
      expect(result.detectedLanguage).toBe('en');
    });
  });

  describe('synthesize (TTS)', () => {
    const ttsRequest: TTSRequest = {
      text: 'नमस्ते',
      language: 'hi',
      agentId: 'agent-123',
    };

    it('should parse successful TTS response with base64 decode', async () => {
      const fakeAudio = Buffer.from('fake-audio-content');
      const base64Audio = fakeAudio.toString('base64');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          audios: [base64Audio],
        }),
      });

      const result = await provider.synthesize(ttsRequest);

      expect(result.audio).toEqual(fakeAudio);
      expect(result.audioFormat).toBe('audio/mp3');
      expect(result.provider).toBe('sarvam');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw VoiceProviderError when audios array is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          audios: [],
        }),
      });

      try {
        await provider.synthesize(ttsRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).message).toContain('Empty audio response');
      }
    });

    it('should send correct JSON body with BCP-47 language code', async () => {
      const fakeAudio = Buffer.from('audio').toString('base64');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          audios: [fakeAudio],
        }),
      });

      await provider.synthesize(ttsRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sarvam.ai/text-to-speech',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'api-subscription-key': 'test-sarvam-key',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.target_language_code).toBe('hi-IN');
      expect(body.model).toBe('bulbul:v3');
      expect(body.text).toBe('नमस्ते');
    });

    it('should use custom speed when provided', async () => {
      const fakeAudio = Buffer.from('audio').toString('base64');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          audios: [fakeAudio],
        }),
      });

      await provider.synthesize({ ...ttsRequest, speed: 1.5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.pace).toBe(1.5);
    });
  });

  describe('language code mapping', () => {
    it('should map all internal codes to BCP-47 correctly', async () => {
      // Test via TTS which uses toSarvamLanguage in the request body
      const mappings: Array<[string, string]> = [
        ['hi', 'hi-IN'],
        ['mr', 'mr-IN'],
        ['bn', 'bn-IN'],
        ['ta', 'ta-IN'],
        ['te', 'te-IN'],
        ['gu', 'gu-IN'],
        ['kn', 'kn-IN'],
        ['ml', 'ml-IN'],
        ['pa', 'pa-IN'],
        ['or', 'od-IN'],  // Sarvam uses od-IN for Odia
        ['en', 'en-IN'],
      ];

      for (const [internal, bcp47] of mappings) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            request_id: 'req-1',
            audios: [Buffer.from('audio').toString('base64')],
          }),
        });

        await provider.synthesize({
          text: 'test',
          language: internal as SupportedLanguage,
          agentId: 'agent-123',
        });

        const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
        expect(body.target_language_code).toBe(bcp47);
      }
    });

    it('should reverse-map BCP-47 to internal codes correctly (via STT)', async () => {
      const reverseMappings: Array<[string, string]> = [
        ['hi-IN', 'hi'],
        ['mr-IN', 'mr'],
        ['bn-IN', 'bn'],
        ['od-IN', 'or'],  // Sarvam od-IN → internal or
        ['en-IN', 'en'],
      ];

      for (const [bcp47, internal] of reverseMappings) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            request_id: null,
            transcript: 'test',
            language_code: bcp47,
            language_probability: 0.9,
            timestamps: null,
          }),
        });

        const result = await provider.transcribe({
          audio: Buffer.from('test'),
          audioFormat: 'audio/webm',
          agentId: 'agent-123',
        });

        expect(result.detectedLanguage).toBe(internal);
      }
    });

    it('should handle hinglish as "unknown" for auto-detect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'test',
          language_code: 'hi-IN',
          language_probability: 0.8,
          timestamps: null,
        }),
      });

      await provider.transcribe({
        audio: Buffer.from('test'),
        audioFormat: 'audio/webm',
        languageHint: 'hinglish',
        agentId: 'agent-123',
      });

      const callArgs = mockFetch.mock.calls[0][1];
      const formData = callArgs.body as FormData;
      expect(formData.get('language_code')).toBe('unknown');
    });
  });

  describe('detectLanguage', () => {
    it('should delegate to STT with "unknown" language code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: null,
          transcript: 'detected text',
          language_code: 'ta-IN',
          language_probability: 0.88,
          timestamps: null,
        }),
      });

      const result = await provider.detectLanguage(
        Buffer.from('test-audio'),
        'audio/webm',
      );

      expect(result.detectedLanguage).toBe('ta');
      expect(result.confidence).toBe(0.88);
      expect(result.provider).toBe('sarvam');

      // Verify "unknown" was sent as language_code
      const callArgs = mockFetch.mock.calls[0][1];
      const formData = callArgs.body as FormData;
      expect(formData.get('language_code')).toBe('unknown');
    });
  });

  describe('error handling', () => {
    const sttRequest: STTRequest = {
      audio: Buffer.from('test'),
      audioFormat: 'audio/webm',
      agentId: 'agent-123',
    };

    it('should map invalid_api_key_error to UNAUTHORIZED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Invalid API key',
            code: 'invalid_api_key_error',
          },
        }),
      });

      await expect(provider.transcribe(sttRequest)).rejects.toThrow(VoiceProviderError);

      // Re-test with fresh mock to check status
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Invalid API key',
            code: 'invalid_api_key_error',
          },
        }),
      });

      try {
        await provider.transcribe(sttRequest);
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      }
    });

    it('should map authentication_error to UNAUTHORIZED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Authentication failed',
            code: 'authentication_error',
          },
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

    it('should map rate_limit_exceeded_error to TOO_MANY_REQUESTS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Rate limit exceeded',
            code: 'rate_limit_exceeded_error',
          },
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

    it('should map invalid_request_error to BAD_REQUEST', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Invalid request',
            code: 'invalid_request_error',
          },
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

    it('should map unprocessable_entity_error to BAD_REQUEST', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Unprocessable',
            code: 'unprocessable_entity_error',
          },
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

    it('should map internal_server_error to BAD_GATEWAY', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          error: {
            request_id: null,
            message: 'Internal error',
            code: 'internal_server_error',
          },
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
          SarvamProvider,
          { provide: ConfigService, useValue: emptyConfigService },
          { provide: ProviderEventLogger, useValue: mockProviderLog },
        ],
      }).compile();

      const p = module.get<SarvamProvider>(SarvamProvider);
      expect(p.name).toBe('sarvam');
    });
  });

  describe('listVoices', () => {
    it('should return the static bulbul:v3 catalog without hitting the network', async () => {
      const voices = await provider.listVoices();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(voices.length).toBeGreaterThan(0);
      // Must include the canonical bulbul:v3 default speaker
      expect(voices.some((v) => v.id === 'priya')).toBe(true);
      // A handful of other documented speakers should be present
      expect(voices.some((v) => v.id === 'kavya')).toBe(true);
      expect(voices.some((v) => v.id === 'aditya')).toBe(true);
      // Must shape entries as VoiceListItem with id + name + gender
      for (const v of voices) {
        expect(v.id).toBeTruthy();
        expect(v.name).toBeTruthy();
        expect(['male', 'female', 'neutral']).toContain(v.gender);
      }
    });

    it('should not include legacy speakers that bulbul:v3 rejects', async () => {
      const ids = (await provider.listVoices()).map((v) => v.id);
      expect(ids).not.toContain('anushka');
      expect(ids).not.toContain('manisha');
      expect(ids).not.toContain('vidya');
    });

    it('should return a fresh array (mutating the result must not affect future calls)', async () => {
      const first = await provider.listVoices();
      first.pop();
      const second = await provider.listVoices();
      expect(second.length).toBeGreaterThan(first.length);
    });
  });

  describe('synthesize speaker selection (regression)', () => {
    const baseRequest: TTSRequest = {
      text: 'नमस्ते',
      language: 'hi',
      agentId: 'agent-123',
    };

    function mockTtsOk() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: 'req-1', audios: [Buffer.from('a').toString('base64')] }),
      });
    }

    it('should send request.voiceId as the speaker', async () => {
      mockTtsOk();
      await provider.synthesize({ ...baseRequest, voiceId: 'kavya' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.speaker).toBe('kavya');
    });

    it('should fall back to priya when no voiceId is provided', async () => {
      mockTtsOk();
      await provider.synthesize(baseRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.speaker).toBe('priya');
    });

    it('should not silently ignore the caller-provided voiceId', async () => {
      mockTtsOk();
      await provider.synthesize({ ...baseRequest, voiceId: 'kavya' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.speaker).not.toBe('priya');
    });
  });

  describe('synthesizePreview (WAV — no MP3 priming silence)', () => {
    const baseRequest: TTSRequest = { text: 'नमस्ते', language: 'hi', agentId: 'a-1' };

    function mockTtsOk() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: 'req-1', audios: [Buffer.from('a').toString('base64')] }),
      });
    }

    it('should request output_audio_codec=wav and return audio/wav', async () => {
      mockTtsOk();
      const result = await provider.synthesizePreview(baseRequest);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.output_audio_codec).toBe('wav');
      expect(result.audioFormat).toBe('audio/wav');
    });

    it('should still pass voiceId / speaker selection through', async () => {
      mockTtsOk();
      await provider.synthesizePreview({ ...baseRequest, voiceId: 'kavya' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.speaker).toBe('kavya');
    });
  });
});
