import { Test } from '@nestjs/testing';
import type { ModelMessage } from 'ai';

import { ContextAssemblyService } from '../../../src/modules/ai/context-assembly.service';
import { HybridContextStrategy } from '../../../src/modules/ai/strategies/hybrid-context.strategy';
import { PrismaService } from '../../../src/services/prisma.service';

describe('HybridContextStrategy', () => {
  let strategy: HybridContextStrategy;
  const mockContext = { assemble: jest.fn() };
  const mockPrisma = {
    chatSession: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HybridContextStrategy,
        { provide: ContextAssemblyService, useValue: mockContext },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    strategy = moduleRef.get(HybridContextStrategy);
  });

  const baseMessages: ModelMessage[] = [
    { role: 'user', content: 'recent question' },
  ];

  const params = {
    chatSessionId: 'sess-1',
    systemPrompt: 'You are helpful.',
    newUserMessage: 'hello',
    organizationId: 'org-1',
    agentId: 'agent-1',
  };

  function baseResult(overrides: Record<string, unknown> = {}) {
    return {
      systemPrompt: 'You are helpful.',
      messages: baseMessages,
      historyCount: 1,
      estimatedTokens: 100,
      truncated: false,
      droppedCount: 0,
      olderMessagesExist: false,
      ...overrides,
    };
  }

  it('passes through untruncated conversations with no DB read', async () => {
    mockContext.assemble.mockResolvedValue(baseResult());
    const result = await strategy.assemble(params);
    expect(result.summaryBlock).toBeUndefined();
    expect(mockPrisma.chatSession.findUnique).not.toHaveBeenCalled();
  });

  it('attaches the persisted summary as summaryBlock when truncated', async () => {
    mockContext.assemble.mockResolvedValue(
      baseResult({ truncated: true, droppedCount: 5, olderMessagesExist: true }),
    );
    mockPrisma.chatSession.findUnique.mockResolvedValue({
      summary: 'User is Ramesh, asked about pricing tiers.',
    });
    const result = await strategy.assemble(params);
    expect(result.summaryBlock).toBe('User is Ramesh, asked about pricing tiers.');
    // NEVER merged into systemPrompt here — placement is the orchestrator's
    // job (this was the discarded-summary bug).
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(mockPrisma.chatSession.findUnique).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      select: { summary: true },
    });
  });

  it('returns base context when no summary has been generated yet', async () => {
    mockContext.assemble.mockResolvedValue(baseResult({ truncated: true }));
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summary: null });
    const result = await strategy.assemble(params);
    expect(result.summaryBlock).toBeUndefined();
  });

  it('ignores the sentinel "no substantive conversation" summary', async () => {
    mockContext.assemble.mockResolvedValue(baseResult({ truncated: true }));
    mockPrisma.chatSession.findUnique.mockResolvedValue({
      summary: 'No substantive conversation yet.',
    });
    const result = await strategy.assemble(params);
    expect(result.summaryBlock).toBeUndefined();
  });

  it('degrades to sliding-window when the summary read fails', async () => {
    mockContext.assemble.mockResolvedValue(baseResult({ truncated: true }));
    mockPrisma.chatSession.findUnique.mockRejectedValue(new Error('db down'));
    const result = await strategy.assemble(params);
    expect(result.summaryBlock).toBeUndefined();
    expect(result.messages).toBe(baseMessages);
  });
});
