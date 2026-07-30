import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, BadGatewayException } from '@nestjs/common';
import {
  VoiceService,
  toSpeakableText,
  hasSpeakableContent,
} from '../../../src/modules/voice/voice.service';
import {
  VOICE_PROVIDERS,
  type VoiceProvider,
  type STTRequest,
  type SupportedLanguage,
  type STTResponse,
  type TTSRequest,
  type TTSResponse,
  type LanguageDetectionResponse,
  VoiceProviderError,
  UnsupportedLanguageError,
} from '../../../src/modules/voice/providers/voice-provider.interface';
import { PrismaService } from '../../../src/services/prisma.service';

function createMockProvider(
  name: string,
  supportedLanguages: string[] = ['en'],
): VoiceProvider {
  return {
    name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supportedLanguages: supportedLanguages as any,
    transcribe: jest.fn().mockResolvedValue({
      transcript: `transcribed by ${name}`,
      confidence: 0.95,
      detectedLanguage: 'en',
      provider: name,
      latencyMs: 10,
    } satisfies STTResponse),
    synthesize: jest.fn().mockResolvedValue({
      audio: Buffer.from(`audio-from-${name}`),
      audioFormat: 'audio/mp3',
      durationMs: 1000,
      provider: name,
      latencyMs: 10,
    } satisfies TTSResponse),
    detectLanguage: jest.fn().mockResolvedValue({
      detectedLanguage: 'en',
      confidence: 0.9,
      provider: name,
      latencyMs: 10,
    } satisfies LanguageDetectionResponse),
  };
}

describe('VoiceService', () => {
  let service: VoiceService;
  let sarvamProvider: VoiceProvider;
  let deepgramProvider: VoiceProvider;
  let elevenLabsProvider: VoiceProvider;
  let stubProvider: VoiceProvider;
  let mockPrisma: { agent: { findUnique: jest.Mock } };

  beforeEach(async () => {
    sarvamProvider = createMockProvider('sarvam', [
      'hi',
      'mr',
      'bn',
      'ta',
      'te',
      'gu',
      'kn',
      'ml',
      'pa',
      'or',
      'en',
      'hinglish',
    ]);
    deepgramProvider = createMockProvider('deepgram', ['en', 'hi']);
    elevenLabsProvider = createMockProvider('elevenlabs', ['en', 'hi']);
    stubProvider = createMockProvider('stub', ['en', 'hi']);

    mockPrisma = {
      agent: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        {
          provide: VOICE_PROVIDERS,
          useValue: [
            stubProvider,
            sarvamProvider,
            deepgramProvider,
            elevenLabsProvider,
          ],
        },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
  });

  afterEach(() => {
    service.clearVoiceConfigCache();
  });

  describe('provider registry', () => {
    it('should register all providers on construction', () => {
      const providers = service.getRegisteredProviders();
      expect(providers).toContain('stub');
      expect(providers).toContain('sarvam');
      expect(providers).toContain('deepgram');
      expect(providers).toContain('elevenlabs');
    });

    it('should return a registered provider by name', () => {
      const provider = service.getProvider('sarvam');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('sarvam');
    });

    it('should throw BadRequestException for unknown provider', () => {
      expect(() => service.getProvider('nonexistent')).toThrow(
        BadRequestException,
      );
      expect(() => service.getProvider('nonexistent')).toThrow(
        'Unknown voice provider: "nonexistent"',
      );
    });

    it('should list all registered provider names', () => {
      const providers = service.getRegisteredProviders();
      expect(providers).toEqual([
        'stub',
        'sarvam',
        'deepgram',
        'elevenlabs',
      ]);
    });
  });

  describe('STT routing', () => {
    const makeSTTRequest = (
      language?: SupportedLanguage,
      agentId = 'agent-123',
    ): STTRequest => ({
      audio: Buffer.from('test-audio'),
      audioFormat: 'audio/webm',
      languageHint: language,
      agentId,
    });

    it('should route Hindi to Sarvam', async () => {
      const result = await service.transcribe(makeSTTRequest('hi'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
    });

    it('should route English to Deepgram', async () => {
      const result = await service.transcribe(makeSTTRequest('en'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
      expect(result.provider).toBe('deepgram');
    });

    it('should route Marathi to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('mr'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Bengali to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('bn'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Tamil to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('ta'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Telugu to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('te'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Gujarati to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('gu'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Kannada to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('kn'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Malayalam to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('ml'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Punjabi to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('pa'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Odia to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('or'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should route Hinglish to Sarvam', async () => {
      await service.transcribe(makeSTTRequest('hinglish'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });

    it('should detect via Sarvam then transcribe via Deepgram for English audio', async () => {
      // Mock Sarvam returns English detected
      (sarvamProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: 'hello (sarvam English — discarded)',
        confidence: 0.9,
        detectedLanguage: 'en',
        provider: 'sarvam',
        latencyMs: 980,
      });
      (deepgramProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: 'hello (deepgram is the trusted answer)',
        confidence: 0.95,
        detectedLanguage: 'en',
        provider: 'deepgram',
        latencyMs: 200,
      });

      const result = await service.transcribe(makeSTTRequest());

      expect(sarvamProvider.transcribe).toHaveBeenCalledTimes(1);
      expect(deepgramProvider.transcribe).toHaveBeenCalledTimes(1);
      expect((deepgramProvider.transcribe as jest.Mock).mock.calls[0][0].languageHint).toBe('en');
      expect(result.provider).toBe('deepgram');
      expect(result.transcript).toBe('hello (deepgram is the trusted answer)');
    });

    it('should keep Sarvam result when an Indian language is detected (no second call)', async () => {
      (sarvamProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: 'नमस्ते',
        confidence: 0.9,
        detectedLanguage: 'hi',
        provider: 'sarvam',
        latencyMs: 980,
      });

      const result = await service.transcribe(makeSTTRequest());

      expect(sarvamProvider.transcribe).toHaveBeenCalledTimes(1);
      expect(deepgramProvider.transcribe).not.toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
      expect(result.transcript).toBe('नमस्ते');
    });

    it('should accept Sarvam empty transcript for Indian languages (no retry helps)', async () => {
      (sarvamProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: '',
        confidence: 0.9,
        detectedLanguage: 'hi',
        provider: 'sarvam',
        latencyMs: 980,
      });

      const result = await service.transcribe(makeSTTRequest());
      expect(sarvamProvider.transcribe).toHaveBeenCalledTimes(1);
      expect(deepgramProvider.transcribe).not.toHaveBeenCalled();
      expect(result.transcript).toBe('');
    });

    it('should fall back to ElevenLabs when Deepgram throws on English transcription', async () => {
      (sarvamProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: '',
        confidence: 0.9,
        detectedLanguage: 'en',
        provider: 'sarvam',
        latencyMs: 100,
      });
      (deepgramProvider.transcribe as jest.Mock).mockRejectedValueOnce(new Error('Deepgram down'));
      (elevenLabsProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: 'hello (elevenlabs)',
        confidence: 0.92,
        detectedLanguage: 'en',
        provider: 'elevenlabs',
        latencyMs: 220,
      });

      const result = await service.transcribe(makeSTTRequest());

      expect(deepgramProvider.transcribe).toHaveBeenCalled();
      expect(elevenLabsProvider.transcribe).toHaveBeenCalled();
      expect(result.provider).toBe('elevenlabs');
    });

    it('should fall back to Sarvam transcript when both Deepgram and ElevenLabs throw', async () => {
      (sarvamProvider.transcribe as jest.Mock).mockResolvedValueOnce({
        transcript: 'hello (sarvam fallback of last resort)',
        confidence: 0.9,
        detectedLanguage: 'en',
        provider: 'sarvam',
        latencyMs: 100,
      });
      (deepgramProvider.transcribe as jest.Mock).mockRejectedValueOnce(new Error('Deepgram down'));
      (elevenLabsProvider.transcribe as jest.Mock).mockRejectedValueOnce(new Error('EL down'));

      const result = await service.transcribe(makeSTTRequest());
      expect(result.transcript).toBe('hello (sarvam fallback of last resort)');
      expect(result.provider).toBe('sarvam');
    });

    it('should use agent override sttProvider when set', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: {
          sttProvider: 'elevenlabs',
        },
      });

      const result = await service.transcribe(makeSTTRequest('hi'));
      expect(elevenLabsProvider.transcribe).toHaveBeenCalled();
      expect(result.provider).toBe('elevenlabs');
    });

    it('should fall back to language-based routing if override provider not found', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: {
          sttProvider: 'nonexistent',
        },
      });

      // This will fail validation and return defaults
      await service.transcribe(makeSTTRequest('hi'));
      expect(sarvamProvider.transcribe).toHaveBeenCalled();
    });
  });

  describe('TTS routing', () => {
    const makeTTSRequest = (
      language: SupportedLanguage = 'en',
      agentId = 'agent-123',
    ): TTSRequest => ({
      text: 'Hello world',
      language,
      agentId,
    });

    it('should route Hindi to Sarvam', async () => {
      const result = await service.synthesize(makeTTSRequest('hi'));
      expect(sarvamProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
    });

    it('should route English to ElevenLabs', async () => {
      const result = await service.synthesize(makeTTSRequest('en'));
      expect(elevenLabsProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('elevenlabs');
    });

    it('should route Marathi to Sarvam', async () => {
      await service.synthesize(makeTTSRequest('mr'));
      expect(sarvamProvider.synthesize).toHaveBeenCalled();
    });

    it('should use agent override ttsProvider when set', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: {
          ttsProvider: 'sarvam',
        },
      });

      const result = await service.synthesize(makeTTSRequest('en'));
      expect(sarvamProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
    });

    it('should route all Indian languages to Sarvam for TTS', async () => {
      const indianLanguages: SupportedLanguage[] = [
        'hi',
        'mr',
        'bn',
        'ta',
        'te',
        'gu',
        'kn',
        'ml',
        'pa',
        'or',
        'hinglish',
      ];

      for (const lang of indianLanguages) {
        jest.clearAllMocks();
        service.clearVoiceConfigCache();
        mockPrisma.agent.findUnique.mockResolvedValue(null);

        await service.synthesize(makeTTSRequest(lang));
        expect(sarvamProvider.synthesize).toHaveBeenCalled();
      }
    });
  });

  describe('TTS fallback', () => {
    const makeTTSRequest = (
      language: SupportedLanguage = 'en',
      agentId = 'agent-123',
    ): TTSRequest => ({
      text: 'Hello world',
      language,
      agentId,
    });

    it('should fall back when provider throws VoiceProviderError', async () => {
      // ElevenLabs is the default for English TTS — make it fail
      (elevenLabsProvider.synthesize as jest.Mock).mockRejectedValueOnce(
        new VoiceProviderError('elevenlabs', 'Service unavailable', 502),
      );

      const result = await service.synthesize(makeTTSRequest('en'));
      // Should fall back to sarvam
      expect(sarvamProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
    });

    it('should fall back when provider throws UnsupportedLanguageError', async () => {
      (elevenLabsProvider.synthesize as jest.Mock).mockRejectedValueOnce(
        new UnsupportedLanguageError('elevenlabs', 'en'),
      );

      const result = await service.synthesize(makeTTSRequest('en'));
      expect(sarvamProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('sarvam');
    });

    it('should throw BadGatewayException when all TTS providers fail', async () => {
      // For English: elevenlabs is primary, then fallback chain is sarvam, elevenlabs
      (elevenLabsProvider.synthesize as jest.Mock).mockRejectedValue(
        new VoiceProviderError('elevenlabs', 'fail', 502),
      );
      (sarvamProvider.synthesize as jest.Mock).mockRejectedValue(
        new VoiceProviderError('sarvam', 'fail', 502),
      );

      await expect(service.synthesize(makeTTSRequest('en'))).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('should rethrow non-VoiceProviderError errors without fallback', async () => {
      (elevenLabsProvider.synthesize as jest.Mock).mockRejectedValueOnce(
        new Error('unexpected error'),
      );

      await expect(service.synthesize(makeTTSRequest('en'))).rejects.toThrow(
        'unexpected error',
      );
    });

    it('should skip the failed provider in fallback chain', async () => {
      // Sarvam is primary for Hindi, make it fail
      (sarvamProvider.synthesize as jest.Mock).mockRejectedValueOnce(
        new VoiceProviderError('sarvam', 'fail', 502),
      );

      const result = await service.synthesize(makeTTSRequest('hi'));
      // Should fall back to elevenlabs (skipping sarvam which is in fallback chain)
      expect(elevenLabsProvider.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('elevenlabs');
    });

    it("must NOT forward the primary provider's voiceId to a different fallback provider", async () => {
      // Regression: Sarvam speaker "aayan" was passed straight to ElevenLabs on
      // fallback → 404 "voice not found" → every fallback sentence failed.
      (sarvamProvider.synthesize as jest.Mock).mockRejectedValueOnce(
        new VoiceProviderError('sarvam', 'Request timed out after 10s', 504),
      );

      const result = await service.synthesize({
        ...makeTTSRequest('hi'),
        voiceId: 'aayan', // Sarvam-specific speaker id
      });

      // Primary keeps its own voiceId...
      expect(sarvamProvider.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'aayan' }),
      );
      // ...but the fallback provider must receive it stripped so it uses its
      // own default voice instead of rejecting an unknown id.
      expect(result.provider).toBe('elevenlabs');
      const fallbackArg = (elevenLabsProvider.synthesize as jest.Mock).mock
        .calls[0][0];
      expect(fallbackArg.voiceId).toBeUndefined();
    });
  });

  describe('detectLanguage', () => {
    it('should route to Sarvam by default', async () => {
      const audio = Buffer.from('test-audio');
      const result = await service.detectLanguage(audio, 'audio/webm');

      expect(sarvamProvider.detectLanguage).toHaveBeenCalledWith(
        audio,
        'audio/webm',
      );
      expect(result.provider).toBe('sarvam');
    });
  });

  describe('voice config', () => {
    const makeSTTRequest = (
      language?: SupportedLanguage,
      agentId = 'agent-123',
    ): STTRequest => ({
      audio: Buffer.from('test-audio'),
      audioFormat: 'audio/webm',
      languageHint: language,
      agentId,
    });

    it('should return defaults when agent not found', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue(null);

      // Default STT routing for English → Deepgram
      await service.transcribe(makeSTTRequest('en'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
    });

    it('should return defaults when voice is disabled', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: false,
        voiceConfig: { sttProvider: 'elevenlabs' },
      });

      // Should ignore the override since voice is disabled → defaults
      await service.transcribe(makeSTTRequest('en'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
    });

    it('should return defaults when voiceConfig is null', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: null,
      });

      await service.transcribe(makeSTTRequest('en'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
    });

    it('should cache voice config per agent', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: { sttProvider: 'elevenlabs' },
      });

      // First call fetches from DB
      await service.transcribe(makeSTTRequest('en', 'agent-1'));
      // Second call should use cache
      await service.transcribe(makeSTTRequest('en', 'agent-1'));

      expect(mockPrisma.agent.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should fetch separately for different agents', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue(null);

      await service.transcribe(makeSTTRequest('en', 'agent-1'));
      await service.transcribe(makeSTTRequest('en', 'agent-2'));

      expect(mockPrisma.agent.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return defaults when DB query fails (column may not exist)', async () => {
      mockPrisma.agent.findUnique.mockRejectedValue(
        new Error('column does not exist'),
      );

      // Should not throw — returns defaults
      await service.transcribe(makeSTTRequest('en'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
    });

    it('should not cache on transient DB errors (allows retry)', async () => {
      mockPrisma.agent.findUnique
        .mockRejectedValueOnce(new Error('connection timeout'))
        .mockResolvedValueOnce({
          voiceEnabled: true,
          voiceConfig: { sttProvider: 'elevenlabs' },
        });

      // First call: DB fails, returns defaults
      await service.transcribe(makeSTTRequest('en', 'agent-retry'));
      expect(deepgramProvider.transcribe).toHaveBeenCalled();

      jest.clearAllMocks();

      // Second call: DB succeeds, should use the real config
      await service.transcribe(makeSTTRequest('en', 'agent-retry'));
      expect(elevenLabsProvider.transcribe).toHaveBeenCalled();
      expect(mockPrisma.agent.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should not route to stub provider for STT or TTS', async () => {
      // Even though stub is registered, it should never be selected by routing
      // All routing should go to sarvam/deepgram/elevenlabs
      await service.transcribe(makeSTTRequest('en'));
      expect(stubProvider.transcribe).not.toHaveBeenCalled();
      expect(deepgramProvider.transcribe).toHaveBeenCalled();
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
      const error = new VoiceProviderError(
        'elevenlabs',
        'Connection failed',
        502,
        original,
      );
      expect(error.originalError).toBe(original);
    });
  });

  describe('UnsupportedLanguageError', () => {
    it('should create error with provider and language', () => {
      const error = new UnsupportedLanguageError('deepgram', 'hi');
      expect(error.message).toBe(
        '[deepgram] Language "hi" is not supported by deepgram',
      );
      expect(error.provider).toBe('deepgram');
      expect(error.language).toBe('hi');
      expect(error.getStatus()).toBe(400);
    });

    it('should be instanceof VoiceProviderError', () => {
      const error = new UnsupportedLanguageError('deepgram', 'hi');
      expect(error).toBeInstanceOf(VoiceProviderError);
    });
  });

  describe('synthesize: voice config enrichment', () => {
    it('should inject config.ttsVoiceId into requests that omit voiceId (widget legacy path)', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: { sttEnabled: true, ttsEnabled: true, ttsVoiceId: 'configured-voice', defaultLanguage: 'en', supportedLanguages: ['en'], ttsSpeed: 1.0, autoDetectLanguage: true },
      });

      await service.synthesize({ text: 'hi', language: 'en', agentId: 'agent-1' });

      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls.at(-1)?.[0];
      expect(passedRequest?.voiceId).toBe('configured-voice');
    });

    it('should let caller-supplied voiceId override config (public synthesize endpoint)', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        voiceEnabled: true,
        voiceConfig: { sttEnabled: true, ttsEnabled: true, ttsVoiceId: 'configured-voice', defaultLanguage: 'en', supportedLanguages: ['en'], ttsSpeed: 1.0, autoDetectLanguage: true },
      });

      await service.synthesize({ text: 'hi', language: 'en', agentId: 'agent-1', voiceId: 'caller-override' });

      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls.at(-1)?.[0];
      expect(passedRequest?.voiceId).toBe('caller-override');
    });
  });

  describe('listAllVoices', () => {
    beforeEach(() => {
      service.clearVoiceListCache();
    });

    it('should return only providers that implement listVoices()', async () => {
      // Attach listVoices to elevenlabs only — sarvam/deepgram remain catalog-less in this test
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockResolvedValue([{ id: 'el-1', name: 'Rachel' }]);

      const result = await service.listAllVoices();

      expect(result).toEqual([
        { provider: 'elevenlabs', voices: [{ id: 'el-1', name: 'Rachel' }] },
      ]);
    });

    it('should aggregate across multiple providers', async () => {
      (sarvamProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockResolvedValue([{ id: 'anushka', name: 'Anushka' }]);
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockResolvedValue([{ id: 'el-1', name: 'Rachel' }]);

      const result = await service.listAllVoices();

      const providers = result.map((p) => p.provider).sort();
      expect(providers).toEqual(['elevenlabs', 'sarvam']);
    });

    it('should cache results — a second call must not re-invoke providers', async () => {
      const elList = jest.fn().mockResolvedValue([{ id: 'el-1', name: 'Rachel' }]);
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = elList;

      await service.listAllVoices();
      await service.listAllVoices();

      expect(elList).toHaveBeenCalledTimes(1);
    });

    it('should coalesce concurrent first calls into a single upstream request', async () => {
      const elList = jest
        .fn()
        .mockImplementation(
          () => new Promise((r) => setTimeout(() => r([{ id: 'el-1', name: 'Rachel' }]), 10)),
        );
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = elList;

      await Promise.all([service.listAllVoices(), service.listAllVoices(), service.listAllVoices()]);

      expect(elList).toHaveBeenCalledTimes(1);
    });

    it('should not fail the whole call when one provider throws — degraded list', async () => {
      (sarvamProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockRejectedValue(new Error('Sarvam down'));
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockResolvedValue([{ id: 'el-1', name: 'Rachel' }]);

      const result = await service.listAllVoices();

      const sarvam = result.find((p) => p.provider === 'sarvam');
      const elevenlabs = result.find((p) => p.provider === 'elevenlabs');
      expect(sarvam?.voices).toEqual([]);
      expect(elevenlabs?.voices).toEqual([{ id: 'el-1', name: 'Rachel' }]);
    });

    it('clearVoiceListCache should force a refetch', async () => {
      const elList = jest.fn().mockResolvedValue([{ id: 'el-1', name: 'Rachel' }]);
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = elList;

      await service.listAllVoices();
      service.clearVoiceListCache();
      await service.listAllVoices();

      expect(elList).toHaveBeenCalledTimes(2);
    });
  });

  describe('previewVoice', () => {
    beforeEach(() => {
      service.clearVoicePreviewCache();
    });

    it('should call the requested provider with sample text and return audio', async () => {
      const result = await service.previewVoice('elevenlabs', 'voice-1', 'en');

      expect(elevenLabsProvider.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceId: 'voice-1',
          language: 'en',
          speed: 1.0,
        }),
      );
      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls[0][0];
      expect(passedRequest.text.length).toBeGreaterThan(0);
      expect(result.audio).toEqual(Buffer.from('audio-from-elevenlabs'));
      expect(result.audioFormat).toBe('audio/mp3');
    });

    it('should personalise the sample text with the voice name from the catalog', async () => {
      (elevenLabsProvider as VoiceProvider & { listVoices: jest.Mock }).listVoices = jest
        .fn()
        .mockResolvedValue([{ id: 'voice-1', name: 'Rachel' }]);
      service.clearVoiceListCache();

      await service.previewVoice('elevenlabs', 'voice-1', 'en');

      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls[0][0];
      expect(passedRequest.text).toContain('Rachel');
    });

    it('should fall back to a generic sample when the voice is not in the catalog', async () => {
      // No listVoices on any provider — name lookup yields undefined
      await service.previewVoice('elevenlabs', 'unknown-voice', 'en');

      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls[0][0];
      expect(passedRequest.text.length).toBeGreaterThan(0);
      expect(passedRequest.text).not.toContain('unknown-voice');
    });

    it('should default to English sample when language is omitted', async () => {
      await service.previewVoice('elevenlabs', 'voice-1');
      const passedRequest = (elevenLabsProvider.synthesize as jest.Mock).mock.calls[0][0];
      expect(passedRequest.language).toBe('en');
    });

    it('should cache results by (provider, voiceId, language)', async () => {
      await service.previewVoice('elevenlabs', 'voice-1', 'en');
      await service.previewVoice('elevenlabs', 'voice-1', 'en');

      expect(elevenLabsProvider.synthesize).toHaveBeenCalledTimes(1);
    });

    it('should treat different voiceIds as separate cache entries', async () => {
      await service.previewVoice('elevenlabs', 'voice-1', 'en');
      await service.previewVoice('elevenlabs', 'voice-2', 'en');

      expect(elevenLabsProvider.synthesize).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException for an unknown / non-TTS provider', async () => {
      await expect(service.previewVoice('deepgram', 'x', 'en')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.previewVoice('made-up', 'x', 'en')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should prefer synthesizePreview() (WAV) over synthesize() (MP3) when implemented', async () => {
      const previewSpy = jest.fn().mockResolvedValue({
        audio: Buffer.from('wav-bytes'),
        audioFormat: 'audio/wav',
        provider: 'elevenlabs',
        latencyMs: 10,
      });
      (elevenLabsProvider as VoiceProvider & { synthesizePreview: jest.Mock }).synthesizePreview =
        previewSpy;

      const result = await service.previewVoice('elevenlabs', 'voice-1', 'en');

      expect(previewSpy).toHaveBeenCalledTimes(1);
      expect(elevenLabsProvider.synthesize).not.toHaveBeenCalled();
      expect(result.audioFormat).toBe('audio/wav');
    });

    it('should fall back to synthesize() when a provider has no synthesizePreview()', async () => {
      // sarvamProvider mock has no synthesizePreview attached — should hit synthesize
      await service.previewVoice('sarvam', 'priya', 'hi');
      expect(sarvamProvider.synthesize).toHaveBeenCalledTimes(1);
    });
  });
});

describe('toSpeakableText / hasSpeakableContent (emoji stripping for TTS)', () => {
  it('reduces a trailing emoji-only tail to nothing speakable (the prod trigger)', () => {
    // "Want to see examples? 🔧🤖" split off a "🔧🤖" chunk → Sarvam 400'd on it.
    expect(toSpeakableText('🔧🤖')).toBe('');
    expect(hasSpeakableContent(toSpeakableText('🔧🤖'))).toBe(false);
  });

  it('keeps the words when an emoji is inline, dropping only the emoji', () => {
    expect(toSpeakableText('Absolutely, emojis are my thing! 😎')).toBe(
      'Absolutely, emojis are my thing!',
    );
    expect(toSpeakableText('Happy to help 😊')).toBe('Happy to help');
    expect(hasSpeakableContent('Happy to help 😊')).toBe(true);
  });

  it('strips compound emoji (ZWJ, skin tone, flags) cleanly', () => {
    expect(toSpeakableText('team 👨‍👩‍👧 here')).toBe('team here');
    expect(toSpeakableText('thumbs 👍🏽 up')).toBe('thumbs up');
    expect(toSpeakableText('flag 🇮🇳 done')).toBe('flag done');
  });

  it('leaves normal punctuation and digits intact (Sarvam speaks those)', () => {
    expect(toSpeakableText('Call us at 1800-123-456.')).toBe(
      'Call us at 1800-123-456.',
    );
    expect(hasSpeakableContent('100%')).toBe(true);
    expect(hasSpeakableContent('Hello, world!')).toBe(true);
  });

  it('treats emoji-only / punctuation-only / empty as not speakable', () => {
    expect(hasSpeakableContent('😎')).toBe(false);
    expect(hasSpeakableContent('...')).toBe(false);
    expect(hasSpeakableContent('   ')).toBe(false);
    expect(hasSpeakableContent('')).toBe(false);
  });
});
