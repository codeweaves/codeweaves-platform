import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  AiSdkService,
  parseModelId,
} from '../../../src/modules/ai/ai-sdk.service';

describe('parseModelId()', () => {
  it.each([
    ['groq:llama-3.3-70b-versatile', 'groq', 'llama-3.3-70b-versatile'],
    ['openai:gpt-4o-mini', 'openai', 'gpt-4o-mini'],
    ['gemini:gemini-2.5-flash', 'gemini', 'gemini-2.5-flash'],
    ['sarvam:sarvam-30b', 'sarvam', 'sarvam-30b'],
    ['cerebras:gpt-oss-120b', 'cerebras', 'gpt-oss-120b'],
    ['openrouter:anthropic/claude-4', 'openrouter', 'anthropic/claude-4'],
    ['anthropic/claude-4', 'openrouter', 'anthropic/claude-4'], // default
    ['gpt-4o-mini', 'openrouter', 'gpt-4o-mini'], // no slash either
  ])('parses %s → provider=%s model=%s', (input, provider, model) => {
    const parsed = parseModelId(input);
    expect(parsed.provider).toBe(provider);
    expect(parsed.modelName).toBe(model);
    expect(parsed.original).toBe(input);
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseModelId('GROQ:llama')).toMatchObject({ provider: 'groq' });
    expect(parseModelId('OpenAI:gpt-4o')).toMatchObject({ provider: 'openai' });
  });

  it('trims whitespace', () => {
    expect(parseModelId('  groq:llama  ')).toMatchObject({
      provider: 'groq',
      modelName: 'llama',
    });
  });
});

describe('AiSdkService', () => {
  let service: AiSdkService;
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };

  beforeEach(async () => {
    env.clear();
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) => env.get(key));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiSdkService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = moduleRef.get(AiSdkService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('isConfigured() / isProviderConfigured()', () => {
    it('returns false when no provider keys set', () => {
      expect(service.isConfigured()).toBe(false);
      expect(service.isProviderConfigured('openai')).toBe(false);
      expect(service.isProviderConfigured('groq')).toBe(false);
      expect(service.isProviderConfigured('gemini')).toBe(false);
      expect(service.isProviderConfigured('openrouter')).toBe(false);
      expect(service.isProviderConfigured('sarvam')).toBe(false);
      expect(service.isProviderConfigured('cerebras')).toBe(false);
    });

    it('returns true once any single provider is configured', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      expect(service.isConfigured()).toBe(true);
      expect(service.isProviderConfigured('openai')).toBe(true);
      expect(service.isProviderConfigured('groq')).toBe(false);
    });
  });

  describe('getDefaultModel()', () => {
    it('returns the env-configured default when set', () => {
      env.set('DEFAULT_AI_MODEL', 'openai:gpt-4o-mini');
      expect(service.getDefaultModel()).toBe('openai:gpt-4o-mini');
    });

    it('falls back to openai/gpt-4.1-mini when env unset', () => {
      expect(service.getDefaultModel()).toBe('openai/gpt-4.1-mini');
    });
  });

  describe('getModel() lazy provider init', () => {
    it('throws when the resolved provider has no key', () => {
      expect(() => service.getModel('openai:gpt-4o-mini')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.getModel('groq:llama-3.3-70b-versatile')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.getModel('gemini:gemini-2.5-flash')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.getModel('sarvam:bulbul-v3')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.getModel('cerebras:gpt-oss-120b')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.getModel('anthropic/claude-4')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('returns a LanguageModel when openai is configured', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      const model = service.getModel('openai:gpt-4o-mini');
      expect(model).toBeDefined();
    });

    it('caches the provider — second call does not re-init', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      const a = service.getModel('openai:gpt-4o-mini');
      const b = service.getModel('openai:gpt-4o-mini');
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it('routes openrouter explicitly via openrouter: prefix', () => {
      env.set('OPENROUTER_API_KEY', 'sk-or-test');
      const model = service.getModel('openrouter:anthropic/claude-4');
      expect(model).toBeDefined();
    });

    it('routes bare vendor/model strings via openrouter (backward-compat)', () => {
      env.set('OPENROUTER_API_KEY', 'sk-or-test');
      const model = service.getModel('anthropic/claude-4');
      expect(model).toBeDefined();
    });
  });

  describe('getEmbeddingModel()', () => {
    it('throws for groq (no embeddings)', () => {
      env.set('GROQ_API_KEY', 'gsk-test');
      expect(() => service.getEmbeddingModel('groq:any')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws for sarvam (no embeddings)', () => {
      env.set('SARVAM_API_KEY', 'sv-test');
      expect(() => service.getEmbeddingModel('sarvam:any')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws for cerebras (no embeddings)', () => {
      env.set('CEREBRAS_API_KEY', 'cb-test');
      expect(() => service.getEmbeddingModel('cerebras:any')).toThrow(
        ServiceUnavailableException,
      );
    });

    it('returns an embedding model for openai', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      const m = service.getEmbeddingModel('openai:text-embedding-3-small');
      expect(m).toBeDefined();
    });
  });

  describe('onModuleInit + onModuleDestroy', () => {
    it('logs a warning when no providers are configured (no warmup)', () => {
      service.onModuleInit();
      // No throw; no heartbeat timer scheduled.
    });

    it('clears the heartbeat interval on destroy', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      env.set('AI_KEEPALIVE_HEARTBEAT_MS', '0'); // disable heartbeat
      service.onModuleInit();
      // No interval to clear; should be a no-op.
      service.onModuleDestroy();
    });

    it('accepts numeric AI_KEEPALIVE_HEARTBEAT_MS', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      env.set('AI_KEEPALIVE_HEARTBEAT_MS', '10000');
      service.onModuleInit();
      service.onModuleDestroy();
    });

    it('falls back to default for malformed AI_KEEPALIVE_HEARTBEAT_MS', () => {
      env.set('OPENAI_API_KEY', 'sk-test');
      env.set('AI_KEEPALIVE_HEARTBEAT_MS', 'not-a-number');
      service.onModuleInit();
      service.onModuleDestroy();
    });
  });
});
