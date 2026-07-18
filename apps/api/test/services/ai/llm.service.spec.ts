import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { APICallError } from 'ai';
import { LlmService } from '../../../src/modules/ai/llm.service';
import { AiSdkService } from '../../../src/modules/ai/ai-sdk.service';
import { ProviderEventLogger } from '../../../src/common/events/provider.logger';

// Mock the AI SDK's generateText + streamText at module level.
jest.mock('ai', () => {
  const actual = jest.requireActual('ai');
  return {
    ...actual,
    generateText: jest.fn(),
    streamText: jest.fn(),
  };
});

import { generateText, streamText } from 'ai';

const mockedGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;
const mockedStreamText = streamText as jest.MockedFunction<typeof streamText>;

describe('LlmService', () => {
  let service: LlmService;
  const mockAiSdk = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getModel: jest.fn().mockReturnValue({} as any),
  };
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };

  beforeEach(async () => {
    env.clear();
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((k: string) => env.get(k));
    mockAiSdk.getModel.mockReturnValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: AiSdkService, useValue: mockAiSdk },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: ProviderEventLogger,
          useValue: { log: jest.fn(), traced: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(LlmService);
  });

  const baseRequest = {
    modelId: 'gpt-4o-mini',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hi' }],
    temperature: 0.7,
    maxTokens: 500,
    organizationId: 'org-1',
    agentId: 'agent-1',
    feature: 'chat' as const,
  };

  describe('generateCompletion()', () => {
    it('returns a fully-normalised result on success', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Hello there',
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          totalTokens: 60,
        },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await service.generateCompletion(baseRequest);
      expect(result).toMatchObject({
        text: 'Hello there',
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          totalTokens: 60,
        },
        finishReason: 'stop',
        retryCount: 0,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('extracts cost from OpenRouter providerMetadata', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        providerMetadata: {
          openrouter: { usage: { cost: 0.0042 } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.cost).toBe(0.0042);
    });

    it('returns null cost for non-OpenRouter providers', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        providerMetadata: { openai: {} },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.cost).toBeNull();
    });

    it('uses OpenRouter actual-model when fallback fires', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        providerMetadata: {
          openrouter: { model: 'anthropic/claude-3-haiku' },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion({
        ...baseRequest,
        modelId: 'anthropic/claude-3.5-sonnet',
      });
      expect(result.model).toBe('anthropic/claude-3-haiku');
    });

    it('falls back to requested model id when no metadata', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('extracts cached tokens from inputTokenDetails (Anthropic shape)', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: {
          inputTokens: 100,
          outputTokens: 5,
          totalTokens: 105,
          inputTokenDetails: { cacheReadTokens: 80 },
        },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(80);
    });

    it('extracts cached tokens from openai.cachedPromptTokens', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: 'stop',
        providerMetadata: { openai: { cachedPromptTokens: 70 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(70);
    });

    it('extracts cached tokens from snake-case prompt_tokens_details', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: 'stop',
        providerMetadata: {
          openai: { prompt_tokens_details: { cached_tokens: 60 } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(60);
    });

    it('extracts cached tokens from google.cachedContentTokenCount', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'Answer',
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: 'stop',
        providerMetadata: { google: { cachedContentTokenCount: 45 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion({
        ...baseRequest,
        modelId: 'gemini:gemini-2.5-flash',
      });
      expect(result.usage.cachedInputTokens).toBe(45);
    });

    it('sets totalTokens fallback when missing', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 30, outputTokens: 5 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.totalTokens).toBe(35);
    });

    it('passes provider-specific options for gemini (thinkingBudget=0)', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        modelId: 'gemini:gemini-2.5-flash',
      });
      const call = mockedGenerateText.mock.calls[0]![0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call as any).providerOptions?.google?.thinkingConfig).toEqual({
        thinkingBudget: 0,
        includeThoughts: false,
      });
    });

    it('passes promptCacheKey for openai', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        modelId: 'openai:gpt-4o-mini',
      });
      const call = mockedGenerateText.mock.calls[0]![0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call as any).providerOptions?.openai).toMatchObject({
        promptCacheKey: 'agent-agent-1',
        promptCacheRetention: '24h',
      });
    });

    it('passes reasoningEffort=none for groq qwen models', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        modelId: 'groq:qwen/qwen3-32b',
      });
      const call = mockedGenerateText.mock.calls[0]![0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call as any).providerOptions?.groq?.reasoningEffort).toBe('none');
    });

    it('forwards fallbackModels as `models` setting (capped at 3)', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        fallbackModels: ['fall-1', 'fall-2', 'fall-3', 'fall-4'],
      });
      const settings = mockAiSdk.getModel.mock.calls[0]![1];
      expect(settings?.models).toEqual(['gpt-4o-mini', 'fall-1', 'fall-2']);
    });

    it('omits model settings when no fallbacks', async () => {
      mockedGenerateText.mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion(baseRequest);
      const settings = mockAiSdk.getModel.mock.calls[0]![1];
      expect(settings).toBeUndefined();
    });

    it('wraps API errors into the same error type for caller inspection', async () => {
      // APICallError needs a url + requestBodyValues per its constructor signature.
      const apiErr = new APICallError({
        message: 'rate limited',
        url: 'https://api.openai.com',
        requestBodyValues: {},
        statusCode: 429,
      });
      mockedGenerateText.mockRejectedValue(apiErr);
      await expect(service.generateCompletion(baseRequest)).rejects.toBe(
        apiErr,
      );
    });

    it('rethrows generic errors', async () => {
      mockedGenerateText.mockRejectedValue(new Error('boom'));
      await expect(service.generateCompletion(baseRequest)).rejects.toThrow(
        'boom',
      );
    });

    it('preserves AbortError name', async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      mockedGenerateText.mockRejectedValue(err);
      await expect(service.generateCompletion(baseRequest)).rejects.toBe(err);
    });
  });

  describe('streamCompletion()', () => {
    function makeStreamResult(chunks: string[], err?: unknown) {
      return {
        get textStream() {
          return (async function* () {
            for (const c of chunks) yield c;
            if (err) throw err;
          })();
        },
        usage: Promise.resolve({
          inputTokens: 20,
          outputTokens: chunks.length,
          totalTokens: 20 + chunks.length,
        }),
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve(undefined),
        text: Promise.resolve(chunks.join('')),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    it('yields text-delta + finish chunks', async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(['Hello ', 'world']));
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);

      const types = out.map((c) => (c as { type: string }).type);
      expect(types).toEqual(['text-delta', 'text-delta', 'finish']);

      const finishChunk = out[out.length - 1] as {
        type: 'finish';
        usage: { totalTokens: number };
        ttftMs: number | null;
        totalMs: number;
      };
      expect(finishChunk.usage.totalTokens).toBe(22);
      expect(finishChunk.ttftMs).not.toBeNull();
      expect(finishChunk.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('skips empty deltas', async () => {
      mockedStreamText.mockReturnValue(
        makeStreamResult(['', 'real', '']),
      );
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);
      const deltas = out.filter(
        (c) => (c as { type: string }).type === 'text-delta',
      );
      expect(deltas).toHaveLength(1);
    });

    it('emits an error chunk on stream failure and rejects completion', async () => {
      mockedStreamText.mockReturnValue(
        makeStreamResult(['partial'], new Error('upstream boom')),
      );
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);

      const errorChunk = out.find(
        (c) => (c as { type: string }).type === 'error',
      ) as { type: 'error'; error: string };
      expect(errorChunk).toBeDefined();
      expect(errorChunk.error).toBe('upstream boom');

      await expect(handle.completion).rejects.toThrow('upstream boom');
    });

    it('completion resolves with normalised result after stream ends', async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(['a', 'b']));
      const handle = await service.streamCompletion(baseRequest);
      // Consume the stream first so the generator's resolveCompletion runs.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      const completion = await handle.completion;
      expect(completion.text).toBe('ab');
      expect(completion.usage.totalTokens).toBe(22);
    });

    it('honours AI_STREAM_TIMEOUT_MS override', async () => {
      env.set('AI_STREAM_TIMEOUT_MS', '5000');
      mockedStreamText.mockReturnValue(makeStreamResult(['x']));
      const handle = await service.streamCompletion(baseRequest);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      // No exception → timeout config was parsed.
      await handle.completion;
    });
  });
});
