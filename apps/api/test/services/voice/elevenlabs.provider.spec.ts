import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { ElevenLabsProvider } from '../../../src/modules/voice/providers/elevenlabs.provider';
import {
  VoiceProviderError,
  type STTRequest,
  type TTSRequest,
} from '../../../src/modules/voice/providers/voice-provider.interface';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ElevenLabsProvider', () => {
  let provider: ElevenLabsProvider;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'ELEVENLABS_API_KEY') return 'test-elevenlabs-key';
      if (key === 'ELEVENLABS_DEFAULT_VOICE_ID') return undefined;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElevenLabsProvider,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    provider = module.get<ElevenLabsProvider>(ElevenLabsProvider);
  });

  describe('provider metadata', () => {
    it('should have name "elevenlabs"', () => {
      expect(provider.name).toBe('elevenlabs');
    });

    it('should support the correct languages', () => {
      expect(provider.supportedLanguages).toContain('en');
      expect(provider.supportedLanguages).toContain('hi');
      expect(provider.supportedLanguages).toContain('ta');
      expect(provider.supportedLanguages).toHaveLength(3);
    });
  });

  describe('synthesize (TTS)', () => {
    const ttsRequest: TTSRequest = {
      text: 'Hello world',
      language: 'en',
      agentId: 'agent-123',
    };

    it('should parse successful TTS response (raw binary to Buffer)', async () => {
      const fakeAudioData = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeAudioData.buffer,
      });

      const result = await provider.synthesize(ttsRequest);

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBe(fakeAudioData.length);
      expect(result.audioFormat).toBe('audio/mp3');
      expect(result.provider).toBe('elevenlabs');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should use default voice ID when none provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize(ttsRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('Xb7hH8MSUJpSbSDYk0k2'),
        expect.any(Object),
      );
    });

    it('should use custom voice ID when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize({ ...ttsRequest, voiceId: 'custom-voice-id' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('custom-voice-id'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('Xb7hH8MSUJpSbSDYk0k2'),
        expect.any(Object),
      );
    });

    it('should send correct headers with xi-api-key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize(ttsRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'xi-api-key': 'test-elevenlabs-key',
          }),
        }),
      );
    });

    it('should send correct JSON body with model and voice settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize({ ...ttsRequest, speed: 1.5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Hello world');
      expect(body.model_id).toBe('eleven_turbo_v2_5');
      expect(body.language_code).toBe('en');
      expect(body.voice_settings.stability).toBe(0.5);
      expect(body.voice_settings.similarity_boost).toBe(0.75);
      expect(body.voice_settings.speed).toBe(1.5);
    });

    it('should sanitize voiceId to prevent URL injection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize({ ...ttsRequest, voiceId: '../v2/admin?evil=true' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('../');
      expect(url).not.toContain('?evil');
      expect(url).toContain(encodeURIComponent('../v2/admin?evil=true'));
    });

    it('should use output_format=mp3_44100_128 in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize(ttsRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=mp3_44100_128'),
        expect.any(Object),
      );
    });

    it('should use 15s timeout for TTS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await provider.synthesize(ttsRequest);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
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
          text: 'Hello world transcript',
          language_code: 'en',
          language_probability: 0.95,
          words: [],
        }),
      });

      const result = await provider.transcribe(sttRequest);

      expect(result.transcript).toBe('Hello world transcript');
      expect(result.confidence).toBe(0.95);
      expect(result.detectedLanguage).toBe('en');
      expect(result.provider).toBe('elevenlabs');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should send FormData with correct fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'test',
          language_code: 'hi',
          language_probability: 0.9,
          words: [],
        }),
      });

      await provider.transcribe(sttRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/speech-to-text',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-elevenlabs-key',
          }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBeInstanceOf(FormData);
    });

    it('should include language_code when languageHint is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'test',
          language_code: 'hi',
          language_probability: 0.9,
          words: [],
        }),
      });

      await provider.transcribe(sttRequest);

      const callArgs = mockFetch.mock.calls[0][1];
      const formData = callArgs.body as FormData;
      expect(formData.get('language_code')).toBe('hi');
      expect(formData.get('model_id')).toBe('scribe_v2');
    });

    it('should omit language_code when no languageHint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'test',
          language_code: 'en',
          language_probability: 0.8,
          words: [],
        }),
      });

      await provider.transcribe({
        audio: Buffer.from('test'),
        audioFormat: 'audio/webm',
        agentId: 'agent-123',
      });

      const callArgs = mockFetch.mock.calls[0][1];
      const formData = callArgs.body as FormData;
      expect(formData.get('language_code')).toBeNull();
    });
  });

  describe('detectLanguage', () => {
    it('should use STT without language_code for auto-detect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'detected text',
          language_code: 'ta',
          language_probability: 0.88,
          words: [],
        }),
      });

      const result = await provider.detectLanguage(
        Buffer.from('test-audio'),
        'audio/webm',
      );

      expect(result.detectedLanguage).toBe('ta');
      expect(result.confidence).toBe(0.88);
      expect(result.provider).toBe('elevenlabs');

      // Verify language_code is NOT sent (auto-detect)
      const callArgs = mockFetch.mock.calls[0][1];
      const formData = callArgs.body as FormData;
      expect(formData.get('language_code')).toBeNull();
      expect(formData.get('model_id')).toBe('scribe_v2');
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
          detail: {
            status: 'unauthorized',
            message: 'Invalid API key',
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

    it('should map 422 to BAD_REQUEST', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          detail: {
            status: 'invalid_request',
            message: 'Invalid request parameters',
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

    it('should map 429 to TOO_MANY_REQUESTS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          detail: {
            status: 'rate_limited',
            message: 'Rate limit exceeded',
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

    it('should map 500/502/503 to BAD_GATEWAY', async () => {
      for (const status of [500, 502, 503]) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status,
          statusText: 'Server Error',
          json: async () => ({
            detail: {
              status: 'server_error',
              message: 'Internal error',
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

    it('should include timeout duration in TTS timeout error message', async () => {
      const timeoutError = new DOMException('The operation was aborted', 'TimeoutError');
      mockFetch.mockRejectedValueOnce(timeoutError);

      const ttsRequest: TTSRequest = {
        text: 'test',
        language: 'en',
        agentId: 'agent-123',
      };

      try {
        await provider.synthesize(ttsRequest);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).message).toContain('15s');
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
          ElevenLabsProvider,
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const p = module.get<ElevenLabsProvider>(ElevenLabsProvider);
      expect(p.name).toBe('elevenlabs');
    });
  });

  describe('custom default voice ID', () => {
    it('should use ELEVENLABS_DEFAULT_VOICE_ID from config when set', async () => {
      const customConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'ELEVENLABS_API_KEY') return 'test-key';
          if (key === 'ELEVENLABS_DEFAULT_VOICE_ID') return 'custom-default-voice';
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ElevenLabsProvider,
          { provide: ConfigService, useValue: customConfigService },
        ],
      }).compile();

      const customProvider = module.get<ElevenLabsProvider>(ElevenLabsProvider);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await customProvider.synthesize({
        text: 'test',
        language: 'en',
        agentId: 'agent-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('custom-default-voice'),
        expect.any(Object),
      );
    });
  });

  describe('listVoices', () => {
    it('should call /v1/voices with the API key and return mapped voices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [
            {
              voice_id: 'voice-1',
              name: 'Rachel',
              preview_url: 'https://cdn.elevenlabs.io/voice-1.mp3',
              labels: {
                gender: 'female',
                language: 'english',
                description: 'calm',
                use_case: 'narration',
                age: 'young',
              },
              category: 'premade',
              // Provider now filters against eleven_turbo_v2_5 (current TTS model)
              high_quality_base_model_ids: ['eleven_turbo_v2_5'],
            },
            {
              voice_id: 'voice-2',
              name: 'Aditya',
              preview_url: 'https://cdn.elevenlabs.io/voice-2.mp3',
              labels: { gender: 'male', accent: 'hindi' },
              category: 'premade',
              // Empty compat list — should still pass filter
              high_quality_base_model_ids: [],
            },
          ],
        }),
      });

      const voices = await provider.listVoices();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'xi-api-key': 'test-elevenlabs-key' }),
        }),
      );
      expect(voices).toHaveLength(2);
      // Rachel: full label set, expect description · use_case · age combined
      expect(voices[0]).toEqual({
        id: 'voice-1',
        name: 'Rachel',
        gender: 'female',
        languages: ['en'],
        category: 'calm · narration · young',
        previewUrl: 'https://cdn.elevenlabs.io/voice-1.mp3',
      });
      // Aditya: only accent label survives, no description/use_case/age
      expect(voices[1]).toEqual({
        id: 'voice-2',
        name: 'Aditya',
        gender: 'male',
        languages: ['hi'],
        category: 'hindi',
        previewUrl: 'https://cdn.elevenlabs.io/voice-2.mp3',
      });
    });

    it('should cap descriptor at 3 parts and skip empty/whitespace labels', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [
            {
              voice_id: 'verbose',
              name: 'Verbose',
              labels: {
                description: 'deep',
                use_case: 'conversational',
                age: 'middle-aged',
                accent: 'british',
                gender: '   ',
              },
              high_quality_base_model_ids: [],
            },
          ],
        }),
      });

      const voices = await provider.listVoices();
      expect(voices[0]?.category).toBe('deep · conversational · middle-aged');
      expect(voices[0]?.gender).toBeUndefined();
    });

    it('should filter out voices not compatible with eleven_turbo_v2_5', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [
            {
              voice_id: 'compatible',
              name: 'Compatible',
              high_quality_base_model_ids: ['eleven_turbo_v2_5', 'eleven_multilingual_v2'],
            },
            {
              voice_id: 'incompatible',
              name: 'Incompatible',
              high_quality_base_model_ids: ['eleven_multilingual_v2'],
            },
          ],
        }),
      });

      const voices = await provider.listVoices();
      expect(voices.map((v) => v.id)).toEqual(['compatible']);
    });

    it('should handle voices with no labels gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          voices: [{ voice_id: 'bare', name: 'Bare', high_quality_base_model_ids: [] }],
        }),
      });

      const voices = await provider.listVoices();
      expect(voices).toEqual([
        {
          id: 'bare',
          name: 'Bare',
          gender: undefined,
          languages: undefined,
          category: undefined,
          previewUrl: undefined,
        },
      ]);
    });

    it('should throw VoiceProviderError on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ detail: { status: 'unauthorized', message: 'Bad API key' } }),
      });

      await expect(provider.listVoices()).rejects.toBeInstanceOf(VoiceProviderError);
    });

    it('should map a timeout to a 504 VoiceProviderError', async () => {
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));

      try {
        await provider.listVoices();
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(VoiceProviderError);
        expect((e as VoiceProviderError).getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
      }
    });
  });

  describe('synthesizePreview (Opus — no MP3 priming silence, free-tier compatible)', () => {
    const ttsRequest: TTSRequest = { text: 'Hello world', language: 'en', agentId: 'a-1' };

    it('should request opus_48000_32 (not mp3) and return audio/ogg', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

      const result = await provider.synthesizePreview(ttsRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('output_format=opus_48000_32'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining('mp3_44100'),
        expect.any(Object),
      );
      expect(result.audioFormat).toBe('audio/ogg');
    });
  });
});
