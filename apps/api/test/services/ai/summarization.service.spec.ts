import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage } from 'ai';
import { SummarizationService } from '../../../src/modules/ai/summarization.service';
import { LlmService } from '../../../src/modules/ai/llm.service';

describe('SummarizationService', () => {
  let service: SummarizationService;
  const mockLlm = { generateCompletion: jest.fn() };
  const mockConfig = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SummarizationService,
        { provide: LlmService, useValue: mockLlm },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = moduleRef.get(SummarizationService);
  });

  const params = {
    organizationId: 'org-1',
    agentId: 'agent-1',
    sessionId: 'sess-1',
  };

  describe('summarize()', () => {
    it('short-circuits to empty result for empty messages', async () => {
      const result = await service.summarize({ ...params, messages: [] });
      expect(result.summary).toBe('');
      expect(result.tokensUsed).toBe(0);
      expect(result.cost).toBeNull();
      expect(result.latencyMs).toBe(0);
      expect(mockLlm.generateCompletion).not.toHaveBeenCalled();
    });

    it('calls LLM with summariser system prompt + transcript', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'The user asked about pricing. The assistant explained tiers.',
        usage: { totalTokens: 80, outputTokens: 20, inputTokens: 60 },
        cost: 0.0001,
        model: 'groq:llama-3.3-70b-versatile',
        latencyMs: 320,
      });

      const messages: ModelMessage[] = [
        { role: 'user', content: 'How much?' },
        { role: 'assistant', content: 'We have three tiers.' },
      ];

      const result = await service.summarize({ ...params, messages });

      expect(mockLlm.generateCompletion).toHaveBeenCalledTimes(1);
      const callArg = mockLlm.generateCompletion.mock.calls[0]![0];
      expect(callArg.systemPrompt).toMatch(/conversation summariser/i);
      expect(callArg.feature).toBe('summarization');
      expect(callArg.temperature).toBe(0.2);
      expect(callArg.messages[0].content).toContain('User: How much?');
      expect(callArg.messages[0].content).toContain(
        'Assistant: We have three tiers.',
      );

      expect(result).toMatchObject({
        summary: 'The user asked about pricing. The assistant explained tiers.',
        tokensUsed: 80,
        cost: 0.0001,
        model: 'groq:llama-3.3-70b-versatile',
      });
    });

    it('uses model override when provided', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'summary',
        usage: { totalTokens: 10, outputTokens: 5, inputTokens: 5 },
        cost: 0,
        model: 'gpt-4o-mini',
        latencyMs: 200,
      });
      await service.summarize({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
        model: 'gpt-4o-mini',
        maxTokens: 100,
      });
      expect(mockLlm.generateCompletion.mock.calls[0]![0]).toMatchObject({
        modelId: 'gpt-4o-mini',
        maxTokens: 100,
      });
    });

    it('uses env SUMMARIZATION_MODEL when set', async () => {
      mockConfig.get.mockImplementation((k: string) =>
        k === 'SUMMARIZATION_MODEL' ? 'openai:gpt-4o-mini' : undefined,
      );
      mockLlm.generateCompletion.mockResolvedValue({
        text: 's',
        usage: { totalTokens: 5, outputTokens: 2, inputTokens: 3 },
        cost: null,
        model: 'openai:gpt-4o-mini',
        latencyMs: 100,
      });
      await service.summarize({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(mockLlm.generateCompletion.mock.calls[0]![0]!.modelId).toBe(
        'openai:gpt-4o-mini',
      );
    });

    it('handles array content parts by concatenating their text', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 's',
        usage: { totalTokens: 1, outputTokens: 1, inputTokens: 0 },
        cost: null,
        model: 'x',
        latencyMs: 50,
      });
      await service.summarize({
        ...params,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' },
            ],
          },
        ],
      });
      const prompt = mockLlm.generateCompletion.mock.calls[0]![0].messages[0]
        .content as string;
      expect(prompt).toContain('User: first second');
    });

    it('trims whitespace from the summary text', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: '   summary text   ',
        usage: { totalTokens: 1, outputTokens: 1, inputTokens: 0 },
        cost: null,
        model: 'x',
        latencyMs: 50,
      });
      const result = await service.summarize({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(result.summary).toBe('summary text');
    });
  });

  describe('generateTitle()', () => {
    it('returns fallback for empty messages', async () => {
      const title = await service.generateTitle({ ...params, messages: [] });
      expect(title).toBe('New Conversation');
      expect(mockLlm.generateCompletion).not.toHaveBeenCalled();
    });

    it('returns generated title trimmed and de-quoted', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: '"Pricing tier questions"',
        usage: { totalTokens: 8, outputTokens: 4, inputTokens: 4 },
        cost: null,
        model: 'x',
        latencyMs: 200,
      });
      const title = await service.generateTitle({
        ...params,
        messages: [{ role: 'user', content: 'How much does it cost?' }],
      });
      expect(title).toBe('Pricing tier questions');
    });

    it('strips trailing punctuation', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'About refunds.',
        usage: { totalTokens: 5, outputTokens: 2, inputTokens: 3 },
        cost: null,
        model: 'x',
        latencyMs: 100,
      });
      const title = await service.generateTitle({
        ...params,
        messages: [{ role: 'user', content: 'refund?' }],
      });
      expect(title).toBe('About refunds');
    });

    it('limits to first 4 messages and caps each at 500 chars', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'short title',
        usage: { totalTokens: 5, outputTokens: 2, inputTokens: 3 },
        cost: null,
        model: 'x',
        latencyMs: 100,
      });
      await service.generateTitle({
        ...params,
        messages: Array.from({ length: 10 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'a'.repeat(600),
        })),
      });
      const prompt = mockLlm.generateCompletion.mock.calls[0]![0].messages[0]
        .content as string;
      // Should only contain 4 role entries.
      expect(prompt.match(/User:|Assistant:/g)?.length).toBe(4);
      // No 600-char strings; each capped at 500.
      expect(prompt).not.toContain('a'.repeat(501));
    });

    it('returns fallback on LLM error (fire-and-forget friendly)', async () => {
      mockLlm.generateCompletion.mockRejectedValue(new Error('LLM down'));
      const title = await service.generateTitle({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(title).toBe('New Conversation');
    });

    it('returns fallback when LLM returns empty string', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: '',
        usage: { totalTokens: 0, outputTokens: 0, inputTokens: 0 },
        cost: null,
        model: 'x',
        latencyMs: 50,
      });
      const title = await service.generateTitle({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(title).toBe('New Conversation');
    });

    it('hard-caps title at 200 chars', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'x'.repeat(500),
        usage: { totalTokens: 100, outputTokens: 50, inputTokens: 50 },
        cost: null,
        model: 'x',
        latencyMs: 100,
      });
      const title = await service.generateTitle({
        ...params,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(title.length).toBeLessThanOrEqual(200);
    });
  });
});
