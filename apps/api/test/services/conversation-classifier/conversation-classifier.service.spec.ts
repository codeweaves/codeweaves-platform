import { Test, TestingModule } from '@nestjs/testing';
import { ConversationClassifierService } from '../../../src/services/conversation-classifier.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AiClassifierService } from '../../../src/common/ai/ai-classifier.service';
import { InternalEventLogger } from '../../../src/common/events/internal.logger';

describe('ConversationClassifierService', () => {
  let service: ConversationClassifierService;

  const mockPrisma = {
    chatSession: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAi = {
    isConfigured: jest.fn(),
    categorize: jest.fn(),
    detectLanguage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationClassifierService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiClassifierService, useValue: mockAi },
        {
          provide: InternalEventLogger,
          useValue: { logStarted: jest.fn(), logCompleted: jest.fn(), logFailed: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConversationClassifierService>(ConversationClassifierService);
    jest.clearAllMocks();
  });

  function makeSession(overrides: Partial<{
    id: string;
    keywords: string[];
    languages: string[];
    messageCount: number;
    /** How long ago this session was created, in hours. Default 24h (well
     *  past the default lifetime of 6h) so the per-row expiry check passes. */
    createdHoursAgo: number;
    sessionLifetimeHours: number;
  }> = {}) {
    const id = overrides.id ?? 's1';
    const keywords = overrides.keywords ?? ['Pricing', 'Support'];
    const languages = overrides.languages ?? ['en', 'hi'];
    const count = overrides.messageCount ?? 5;
    const createdHoursAgo = overrides.createdHoursAgo ?? 24;
    const sessionLifetimeHours = overrides.sessionLifetimeHours ?? 6;
    const messages = Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: `message ${i}`,
      createdAt: new Date(`2026-05-10T10:0${i}:00Z`),
    }));
    return {
      id,
      createdAt: new Date(Date.now() - createdHoursAgo * 60 * 60 * 1000),
      agent: {
        categoryKeywords: keywords,
        supportedLanguages: languages,
        sessionLifetimeHours,
      },
      messages,
    };
  }

  describe('runBatch — guard rails', () => {
    it('runs even when AI is not configured (status expiry doesn\'t need the LLM)', async () => {
      // The job has TWO concerns: classification (needs LLM) and status
      // expiry (just a DB write). Even with no API key the sweep should run
      // so the dashboard's status filter stays correct.
      mockAi.isConfigured.mockReturnValue(false);
      mockPrisma.chatSession.findMany.mockResolvedValue([]);

      const processed = await service.runBatch();

      expect(processed).toBe(0); // nothing to process in this test
      // Critically: findMany WAS called. The job did not short-circuit.
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('triggerBatch — background + overlap guard', () => {
    it('starts a background pass and is a no-op while one is running', async () => {
      let release!: () => void;
      mockPrisma.chatSession.findMany.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
      );

      expect(service.triggerBatch()).toBe(true); // first starts
      expect(service.triggerBatch()).toBe(false); // second blocked while running

      release();
      await new Promise((r) => setImmediate(r)); // let it settle + clear the guard

      expect(service.triggerBatch()).toBe(true); // free again
    });
  });

  describe('runBatch — selection query', () => {
    beforeEach(() => {
      // selection-query tests assume the AI gate has passed
      mockAi.isConfigured.mockReturnValue(true);
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
    });

    it('excludes already-classified sessions', async () => {
      await service.runBatch();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.categorizedAt).toBeNull();
    });

    it('requires the parent agent to be non-deleted but does NOT require any classification config', async () => {
      // Status expiry runs for every quiet session, regardless of whether
      // the agent uses categories or languages. The LLM calls are gated
      // per-dimension inside the loop, not at candidate-selection time.
      await service.runBatch();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.agent).toEqual({ deletedAt: null });
    });

    it('caps the batch size to MAX_PER_RUN (200)', async () => {
      await service.runBatch();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.take).toBe(200);
    });

    it('orders by oldest-quiet first (fairness)', async () => {
      await service.runBatch();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.orderBy).toEqual({ lastMessageAt: 'asc' });
    });

    it('uses a 1h pre-filter cutoff on lastMessageAt (precise per-agent expiry happens in the loop)', async () => {
      const before = Date.now();
      await service.runBatch();
      const after = Date.now();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      const cutoffMs = (arg.where.lastMessageAt.lte as Date).getTime();
      const oneHourMs = 60 * 60 * 1000;
      // Loose pre-filter: any session quiet for 1h+ is a candidate. The
      // actual lifetime gate is per-agent and lives in the for-loop.
      expect(cutoffMs).toBeGreaterThanOrEqual(before - oneHourMs - 100);
      expect(cutoffMs).toBeLessThanOrEqual(after - oneHourMs + 100);
    });

    it('also selects createdAt + agent.sessionLifetimeHours for the per-row expiry check', async () => {
      await service.runBatch();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.select.createdAt).toBe(true);
      expect(arg.select.agent.select.sessionLifetimeHours).toBe(true);
    });
  });

  describe('runBatch — processing', () => {
    beforeEach(() => {
      mockAi.isConfigured.mockReturnValue(true);
    });

    it('classifies a long-enough session and writes both labels back', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 's1', messageCount: 6 }),
      ]);
      mockAi.categorize.mockResolvedValue('Pricing');
      mockAi.detectLanguage.mockResolvedValue('en');

      const processed = await service.runBatch();

      expect(processed).toBe(1);
      expect(mockAi.categorize).toHaveBeenCalledWith(
        expect.any(String),
        ['Pricing', 'Support'],
      );
      // detectLanguage now also receives the agent's supportedLanguages list
      expect(mockAi.detectLanguage).toHaveBeenCalledWith(
        expect.any(String),
        ['en', 'hi'],
      );
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: {
          category: 'Pricing',
          detectedLanguage: 'en',
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });

    it('marks too-short sessions classified-with-null so they are not re-evaluated', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 'short', messageCount: 2 }),
      ]);

      const processed = await service.runBatch();

      // Too-short doesn't count toward processed count, but DOES get a write
      // so the row stops re-appearing in subsequent picks.
      expect(processed).toBe(0);
      expect(mockAi.categorize).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'short' },
        data: {
          category: null,
          detectedLanguage: null,
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });

    it('persists null when the classifier returns null (no match)', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 's2' }),
      ]);
      mockAi.categorize.mockResolvedValue(null);
      mockAi.detectLanguage.mockResolvedValue(null);

      await service.runBatch();

      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 's2' },
        data: {
          category: null,
          detectedLanguage: null,
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });

    it('runs categorize and detectLanguage in parallel per session', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 's3' }),
      ]);
      // If they were serial, total time would be ~200ms; parallel is ~100ms.
      // Don't bother timing — just assert both were called for the same session.
      mockAi.categorize.mockResolvedValue('Pricing');
      mockAi.detectLanguage.mockResolvedValue('en');

      await service.runBatch();

      expect(mockAi.categorize).toHaveBeenCalledTimes(1);
      expect(mockAi.detectLanguage).toHaveBeenCalledTimes(1);
    });

    it('skips sessions that haven\'t passed their per-agent lifetime yet', async () => {
      // Quiet for over an hour (passes the loose pre-filter) but only 2h old
      // with a 24h lifetime — must NOT be processed this run.
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({
          id: 'still-live',
          createdHoursAgo: 2,
          sessionLifetimeHours: 24,
        }),
      ]);

      const processed = await service.runBatch();

      expect(processed).toBe(0);
      expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
      expect(mockAi.categorize).not.toHaveBeenCalled();
      expect(mockAi.detectLanguage).not.toHaveBeenCalled();
    });

    it('processes multiple sessions in a single batch', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 'a' }),
        makeSession({ id: 'b' }),
        makeSession({ id: 'c' }),
      ]);
      mockAi.categorize.mockResolvedValue('Support');
      mockAi.detectLanguage.mockResolvedValue('en');

      const processed = await service.runBatch();

      expect(processed).toBe(3);
      expect(mockPrisma.chatSession.update).toHaveBeenCalledTimes(3);
    });

    it('flips status to EXPIRED with null labels for agents that use neither classification dimension', async () => {
      // An agent with no categories AND no languages still has its quiet
      // sessions swept — the LLM calls are skipped (saves money) but the
      // DB write still happens so the status filter is universally correct.
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 'no-config', keywords: [], languages: [] }),
      ]);

      const processed = await service.runBatch();

      expect(processed).toBe(1);
      expect(mockAi.categorize).not.toHaveBeenCalled();
      expect(mockAi.detectLanguage).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'no-config' },
        data: {
          category: null,
          detectedLanguage: null,
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });

    it('calls only categorize when the agent has keywords but no languages', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 'cats-only', keywords: ['Pricing'], languages: [] }),
      ]);
      mockAi.categorize.mockResolvedValue('Pricing');

      await service.runBatch();

      expect(mockAi.categorize).toHaveBeenCalledTimes(1);
      expect(mockAi.detectLanguage).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'cats-only' },
        data: {
          category: 'Pricing',
          detectedLanguage: null,
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });

    it('calls only detectLanguage when the agent has languages but no keywords', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        makeSession({ id: 'langs-only', keywords: [], languages: ['en'] }),
      ]);
      mockAi.detectLanguage.mockResolvedValue('en');

      await service.runBatch();

      expect(mockAi.categorize).not.toHaveBeenCalled();
      expect(mockAi.detectLanguage).toHaveBeenCalledTimes(1);
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'langs-only' },
        data: {
          category: null,
          detectedLanguage: 'en',
          categorizedAt: expect.any(Date),
          status: 'EXPIRED',
        },
      });
    });
  });
});
