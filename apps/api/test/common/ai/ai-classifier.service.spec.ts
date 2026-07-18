import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiClassifierService } from '../../../src/common/ai/ai-classifier.service';
import { ProviderEventLogger } from '../../../src/common/events/provider.logger';

describe('AiClassifierService', () => {
  let originalFetch: typeof fetch;

  function makeService(apiKey: string | undefined, model?: string) {
    return Test.createTestingModule({
      providers: [
        AiClassifierService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'OPENAI_API_KEY') return apiKey;
              if (key === 'AI_CLASSIFIER_MODEL') return model;
              return undefined;
            },
          },
        },
        { provide: ProviderEventLogger, useValue: { log: jest.fn() } },
      ],
    })
      .compile()
      .then((m: TestingModule) => m.get(AiClassifierService));
  }

  /**
   * Build a fetch mock returning a Chat Completions response that mimics
   * structured-outputs mode: `message.content` is a JSON string matching
   * whatever schema the call requested.
   */
  function mockJsonResponse(payload: object | null, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: jest.fn().mockResolvedValue(''),
      json: jest.fn().mockResolvedValue({
        choices: [
          {
            message: payload === null ? {} : { content: JSON.stringify(payload) },
          },
        ],
      }),
    }) as unknown as typeof fetch;
  }

  /** Mocks a model refusal — OpenAI's safety mechanism. */
  function mockRefusal(reason: string) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { refusal: reason } }],
      }),
    }) as unknown as typeof fetch;
  }

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('reports false when OPENAI_API_KEY is missing', async () => {
      const svc = await makeService(undefined);
      expect(svc.isConfigured()).toBe(false);
    });

    it('reports true when OPENAI_API_KEY is present', async () => {
      const svc = await makeService('sk-test');
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe('categorize', () => {
    it('returns null and does not call the API when unconfigured', async () => {
      const svc = await makeService(undefined);
      global.fetch = jest.fn() as unknown as typeof fetch;

      const result = await svc.categorize('hello world', ['Pricing', 'Support']);

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns null when categories list is empty', async () => {
      const svc = await makeService('sk-test');
      global.fetch = jest.fn() as unknown as typeof fetch;
      const result = await svc.categorize('hello', []);
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns the picked category on high-confidence match', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ category: 'Pricing', confidence: 'high' });

      const result = await svc.categorize('how much does it cost?', ['Pricing', 'Support']);

      expect(result).toBe('Pricing');
    });

    it('returns the picked category on medium-confidence match', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ category: 'Support', confidence: 'medium' });

      const result = await svc.categorize('thing is broken kinda', ['Pricing', 'Support']);

      expect(result).toBe('Support');
    });

    it('returns null when the model picks NONE (no fit / too thin)', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ category: 'NONE', confidence: 'high' });
      const result = await svc.categorize('hi', ['Pricing']);
      expect(result).toBeNull();
    });

    it('returns null when confidence is low even if a category was picked', async () => {
      // We refuse to persist a guess — low confidence => null.
      const svc = await makeService('sk-test');
      mockJsonResponse({ category: 'Pricing', confidence: 'low' });
      const result = await svc.categorize('uh', ['Pricing', 'Support']);
      expect(result).toBeNull();
    });

    it('returns null when the model refuses (safety refusal)', async () => {
      const svc = await makeService('sk-test');
      mockRefusal('Refusing for safety reasons.');
      const result = await svc.categorize('hi', ['Pricing']);
      expect(result).toBeNull();
    });

    it('returns null on a non-2xx HTTP response', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse(null, 500);
      const result = await svc.categorize('hi', ['Pricing']);
      expect(result).toBeNull();
    });

    it('returns null when fetch throws (network error / timeout)', async () => {
      const svc = await makeService('sk-test');
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('aborted')) as unknown as typeof fetch;

      const result = await svc.categorize('hi', ['Pricing']);
      expect(result).toBeNull();
    });

    it('returns null when the response content is not valid JSON (defensive)', async () => {
      const svc = await makeService('sk-test');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
        json: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'not-json' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await svc.categorize('hi', ['Pricing']);
      expect(result).toBeNull();
    });

    it('sends a strict json_schema response_format with the categories enum + NONE', async () => {
      const svc = await makeService('sk-test-123', 'gpt-4o-mini-test');
      mockJsonResponse({ category: 'Pricing', confidence: 'high' });

      await svc.categorize('hi', ['Pricing', 'Support']);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4o-mini-test');
      expect(body.temperature).toBe(0);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
      // The category enum must include all provided categories AND the NONE sentinel.
      expect(body.response_format.json_schema.schema.properties.category.enum).toEqual([
        'Pricing',
        'Support',
        'NONE',
      ]);
      expect(body.response_format.json_schema.schema.properties.confidence.enum).toEqual([
        'high',
        'medium',
        'low',
      ]);
    });
  });

  describe('detectLanguage', () => {
    it('returns null when unconfigured', async () => {
      const svc = await makeService(undefined);
      const result = await svc.detectLanguage('hello world', ['en', 'hi']);
      expect(result).toBeNull();
    });

    it('returns null when allowedLanguages is empty (feature disabled for agent)', async () => {
      const svc = await makeService('sk-test');
      global.fetch = jest.fn() as unknown as typeof fetch;
      const result = await svc.detectLanguage('hello world', []);
      expect(result).toBeNull();
      // Critical: empty list short-circuits before the LLM call — no wasted spend.
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns the agent-allowed code on success', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'en' });
      const result = await svc.detectLanguage('hello world', ['en', 'hi']);
      expect(result).toBe('en');
    });

    it('returns null when the model picks "und" (undetermined)', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'und' });
      const result = await svc.detectLanguage('???', ['en', 'hi']);
      expect(result).toBeNull();
    });

    it('returns "other" when the model picks "other" (real language but outside the allowed list)', async () => {
      // Configured for English+Hindi only, but the conversation was in Spanish.
      // Stored as "other" so the analytics dashboard can surface unmet demand.
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'other' });
      const result = await svc.detectLanguage('hola, ¿cómo estás?', ['en', 'hi']);
      expect(result).toBe('other');
    });

    it('returns "hinglish" when allowed and the model picks it', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'hinglish' });
      const result = await svc.detectLanguage(
        'mera order kahan hai, can you check please?',
        ['en', 'hi', 'hinglish'],
      );
      expect(result).toBe('hinglish');
    });

    it('builds the response_format enum from the agent\'s allowedLanguages list + sentinels', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'hi' });

      await svc.detectLanguage('namaste, kaise ho?', ['en', 'hi', 'mr']);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse((call[1] as RequestInit).body as string);
      const enumValues = body.response_format.json_schema.schema.properties.language.enum as string[];
      // The enum is exactly the supplied list + the two sentinels — no
      // extra languages get smuggled in.
      expect(enumValues).toEqual(['en', 'hi', 'mr', 'other', 'und']);
    });

    it('includes hinglish guidance in the system prompt only when hinglish is allowed', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'en' });

      await svc.detectLanguage('hi there', ['en', 'hi', 'hinglish']);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse((call[1] as RequestInit).body as string);
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMsg.content).toContain('Hinglish guidance');
    });

    it('omits hinglish guidance when hinglish is NOT in the allowed list', async () => {
      const svc = await makeService('sk-test');
      mockJsonResponse({ language: 'en' });

      await svc.detectLanguage('hi there', ['en', 'es']);

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse((call[1] as RequestInit).body as string);
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
      expect(systemMsg.content).not.toContain('Hinglish');
    });
  });
});
