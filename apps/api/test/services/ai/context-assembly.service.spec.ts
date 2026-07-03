import { Test } from '@nestjs/testing';
import { ContextAssemblyService } from '../../../src/modules/ai/context-assembly.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('ContextAssemblyService', () => {
  let service: ContextAssemblyService;
  const mockPrisma = {
    chatMessage: { findMany: jest.fn(), count: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextAssemblyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(ContextAssemblyService);
  });

  const baseParams = {
    chatSessionId: 'sess-1',
    systemPrompt: 'You are helpful.',
    newUserMessage: 'Hello',
  };

  describe('DB path', () => {
    it('loads history from Postgres in chronological order and appends new turn', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { role: 'ASSISTANT', content: 'Hi back' },
        { role: 'USER', content: 'Hi' },
      ]); // returned desc

      const result = await service.assemble(baseParams);
      // Reversed to chronological + new turn appended.
      expect(result.messages.map((m) => m.content)).toEqual([
        'Hi',
        'Hi back',
        'Hello',
      ]);
      expect(result.historyCount).toBe(2);
      expect(result.olderMessagesExist).toBe(false);
      expect(result.truncated).toBe(false);
    });

    it('labels HUMAN_AGENT and SYSTEM turns so the model tells them apart from its own', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { role: 'SYSTEM', content: 'Resolved by Priya — AI resumed' },
        { role: 'HUMAN_AGENT', content: 'This is Priya, happy to help.' },
        { role: 'ASSISTANT', content: 'Hi back' },
        { role: 'USER', content: 'Hi' },
      ]); // returned desc

      const result = await service.assemble(baseParams);

      // Human teammate turn → labelled, assistant role.
      const humanTurn = result.messages.find(
        (m) => typeof m.content === 'string' && m.content.includes('This is Priya'),
      );
      expect(humanTurn).toEqual({
        role: 'assistant',
        content: '[Human teammate]: This is Priya, happy to help.',
      });
      // Handover status line → labelled [System], so the model reads it as an
      // event (the human handed the chat back), not its own words.
      const systemTurn = result.messages.find(
        (m) => typeof m.content === 'string' && m.content.includes('Resolved by Priya'),
      );
      expect(systemTurn).toEqual({
        role: 'assistant',
        content: '[System]: Resolved by Priya — AI resumed',
      });
    });

    it('returns just the new turn when no history exists', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      const result = await service.assemble(baseParams);
      expect(result.messages).toEqual([
        { role: 'user', content: 'Hello' },
      ]);
      expect(result.historyCount).toBe(0);
    });

    it('reports olderMessagesExist when LIMIT hits message cap', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue(
        Array.from({ length: 20 }, () => ({
          role: 'USER',
          content: 'msg',
        })),
      );
      mockPrisma.chatMessage.count.mockResolvedValue(50);

      const result = await service.assemble(baseParams);
      expect(result.olderMessagesExist).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it('skips count() when loaded < messageCap (no truncation possible)', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { role: 'USER', content: 'only one' },
      ]);
      await service.assemble(baseParams);
      expect(mockPrisma.chatMessage.count).not.toHaveBeenCalled();
    });

    it('caps message limit at MAX_HISTORY_HARD_CAP (100)', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      await service.assemble({
        ...baseParams,
        maxContextMessages: 9999,
      });
      const { take } = mockPrisma.chatMessage.findMany.mock.calls[0]![0];
      expect(take).toBe(100);
    });

    it('clamps messageCap to a minimum of 1', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      await service.assemble({
        ...baseParams,
        maxContextMessages: -5,
      });
      const { take } = mockPrisma.chatMessage.findMany.mock.calls[0]![0];
      expect(take).toBe(1);
    });
  });

  describe('client-supplied recentHistory (hot path)', () => {
    it('skips DB lookup when recentHistory is provided', async () => {
      const result = await service.assemble({
        ...baseParams,
        recentHistory: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ],
      });
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(result.messages.map((m) => m.content)).toEqual([
        'first',
        'second',
        'Hello',
      ]);
      // No authoritative signal from client history.
      expect(result.olderMessagesExist).toBe(false);
    });

    it('uses the last N entries when recentHistory exceeds messageCap', async () => {
      const history = Array.from({ length: 30 }, (_, i) => ({
        role: 'user' as const,
        content: `m${i}`,
      }));
      const result = await service.assemble({
        ...baseParams,
        maxContextMessages: 5,
        recentHistory: history,
      });
      // Last 5 + new turn
      expect(result.historyCount).toBe(5);
      expect(result.messages[0]!.content).toBe('m25');
      expect(result.messages[4]!.content).toBe('m29');
    });
  });

  describe('token budget enforcement', () => {
    it('drops oldest messages when exceeding the token budget', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue(
        Array.from({ length: 5 }, () => ({
          role: 'USER',
          // Each message ~1000 chars ≈ 250 tokens (cheap estimate cpath).
          content: 'a'.repeat(1000),
        })),
      );
      // Tiny budget — forces dropping.
      const result = await service.assemble({
        ...baseParams,
        maxInputTokens: 400,
      });
      // MIN_MESSAGES_TO_KEEP=2 means we still keep at least 2 messages.
      expect(result.historyCount).toBe(2);
      expect(result.truncated).toBe(true);
      expect(result.droppedCount).toBeGreaterThanOrEqual(3);
    });

    it('keeps everything when budget is generous', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue(
        Array.from({ length: 3 }, () => ({ role: 'USER', content: 'tiny' })),
      );
      const result = await service.assemble({
        ...baseParams,
        maxInputTokens: 100_000,
      });
      expect(result.historyCount).toBe(3);
      expect(result.truncated).toBe(false);
    });

    it('handles empty new user message gracefully', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([
        { role: 'USER', content: 'previous' },
      ]);
      const result = await service.assemble({
        ...baseParams,
        newUserMessage: '',
      });
      // No new turn appended when input is empty.
      expect(result.messages[result.messages.length - 1]!.content).toBe(
        'previous',
      );
    });

    it('handles array-content messages from client history', async () => {
      const result = await service.assemble({
        ...baseParams,
        recentHistory: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { role: 'user', content: [{ type: 'text', text: 'multi' }] as any },
        ],
      });
      expect(result.historyCount).toBe(1);
    });

    it('returns positive estimatedTokens', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      const result = await service.assemble(baseParams);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });
});
