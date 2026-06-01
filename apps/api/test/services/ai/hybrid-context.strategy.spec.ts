import { Test } from '@nestjs/testing';
import type { ModelMessage } from 'ai';
import { HybridContextStrategy } from '../../../src/modules/ai/strategies/hybrid-context.strategy';
import { ContextAssemblyService } from '../../../src/modules/ai/context-assembly.service';
import { SummarizationService } from '../../../src/modules/ai/summarization.service';
import { TokenCounterService } from '../../../src/modules/ai/token-counter.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('HybridContextStrategy', () => {
  let strategy: HybridContextStrategy;
  const mockContext = { assemble: jest.fn() };
  const mockSummarization = { summarize: jest.fn() };
  const mockTokenCounter = { countPromptContext: jest.fn() };
  const mockPrisma = {
    chatMessage: { count: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HybridContextStrategy,
        { provide: ContextAssemblyService, useValue: mockContext },
        { provide: SummarizationService, useValue: mockSummarization },
        { provide: TokenCounterService, useValue: mockTokenCounter },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    strategy = moduleRef.get(HybridContextStrategy);
    mockTokenCounter.countPromptContext.mockReturnValue(1500);
  });

  const baseMessages: ModelMessage[] = [
    { role: 'user', content: 'recent question' },
  ];

  const params = {
    chatSessionId: 'sess-1',
    organizationId: 'org-1',
    agentId: 'agent-1',
    systemPrompt: 'You are helpful.',
    newUserMessage: 'Hello',
    maxContextMessages: 20,
  };

  it('returns base context unchanged when nothing was truncated (fast path)', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: false,
      olderMessagesExist: false,
    });

    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(mockSummarization.summarize).not.toHaveBeenCalled();
    expect(mockPrisma.chatMessage.count).not.toHaveBeenCalled();
  });

  it('returns base context when total messages do not exceed the cap (defensive)', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(15);

    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(mockSummarization.summarize).not.toHaveBeenCalled();
  });

  it('summarises older messages and injects summary into system prompt', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(40);
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'old user' },
      { role: 'ASSISTANT', content: 'old asst' },
    ]);
    mockSummarization.summarize.mockResolvedValue({
      summary: 'User asked about X. Assistant explained Y.',
      tokensUsed: 80,
      cost: 0,
      model: 'groq',
      latencyMs: 200,
    });

    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toContain('You are helpful.');
    expect(result.systemPrompt).toContain('[SUMMARY OF EARLIER CONVERSATION]');
    expect(result.systemPrompt).toContain('User asked about X.');
    expect(result.estimatedTokens).toBe(1500);
    expect(mockSummarization.summarize).toHaveBeenCalledTimes(1);
  });

  it('skips injection when summary is the no-op sentinel', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(40);
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'hi' },
    ]);
    mockSummarization.summarize.mockResolvedValue({
      summary: 'No substantive conversation yet.',
      tokensUsed: 10,
      cost: 0,
      model: 'groq',
      latencyMs: 80,
    });

    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toBe('You are helpful.');
  });

  it('reuses cached summary when generation matches', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(40);
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'old' },
    ]);
    mockSummarization.summarize.mockResolvedValue({
      summary: 'cached summary',
      tokensUsed: 50,
      cost: 0,
      model: 'groq',
      latencyMs: 100,
    });

    await strategy.assemble(params);
    await strategy.assemble(params);

    // Second call hits cache — summarise only called once.
    expect(mockSummarization.summarize).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache when generation changes (new messages arrived)', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'old' },
    ]);
    mockSummarization.summarize
      .mockResolvedValueOnce({
        summary: 'first',
        tokensUsed: 1,
        cost: 0,
        model: 'g',
        latencyMs: 1,
      })
      .mockResolvedValueOnce({
        summary: 'second',
        tokensUsed: 1,
        cost: 0,
        model: 'g',
        latencyMs: 1,
      });

    mockPrisma.chatMessage.count.mockResolvedValueOnce(40);
    await strategy.assemble(params);
    mockPrisma.chatMessage.count.mockResolvedValueOnce(45);
    const second = await strategy.assemble(params);

    expect(mockSummarization.summarize).toHaveBeenCalledTimes(2);
    expect(second.systemPrompt).toContain('second');
  });

  it('falls back to base context (no throw) when summarisation fails', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(40);
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'old' },
    ]);
    mockSummarization.summarize.mockRejectedValue(new Error('LLM down'));

    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toBe('You are helpful.');
  });

  it('returns base when older-message query is empty (race)', async () => {
    mockContext.assemble.mockResolvedValue({
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      estimatedTokens: 500,
      truncated: true,
      olderMessagesExist: true,
    });
    mockPrisma.chatMessage.count.mockResolvedValue(40);
    mockPrisma.chatMessage.findMany.mockResolvedValue([]);
    const result = await strategy.assemble(params);
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(mockSummarization.summarize).not.toHaveBeenCalled();
  });
});
