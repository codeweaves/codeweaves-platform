import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataExtractionService } from '../../../src/services/data-extraction.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AiClassifierService } from '../../../src/common/ai/ai-classifier.service';
import { InternalEventLogger } from '../../../src/common/events/internal.logger';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

describe('DataExtractionService', () => {
  let service: DataExtractionService;

  const mockPrisma = {
    chatSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    collectedData: { upsert: jest.fn() },
  };
  const mockAi = { extractFields: jest.fn() };
  const mockConfig = { get: jest.fn() };
  // Passthrough crypto: tests assert on plaintext; encryption is unit-tested
  // separately in crypto.service.spec.ts. Implementations are (re)applied in
  // beforeEach because jest.config has resetMocks: true.
  const mockCrypto = {
    encryptFieldValues: jest.fn(),
    decryptFieldValues: jest.fn(),
  };

  const sessionId = 'sess-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.encryptFieldValues.mockImplementation(
      (d: Record<string, unknown>) => d,
    );
    mockCrypto.decryptFieldValues.mockImplementation(
      (d: Record<string, unknown> | null | undefined) => d ?? {},
    );
    mockConfig.get.mockReturnValue(undefined); // use defaults; timer not started (.compile doesn't call onModuleInit)
    const moduleRef = await Test.createTestingModule({
      providers: [
        DataExtractionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiClassifierService, useValue: mockAi },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: InternalEventLogger,
          useValue: { logStarted: jest.fn(), logCompleted: jest.fn(), logFailed: jest.fn() },
        },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    service = moduleRef.get(DataExtractionService);
  });

  const baseSession = (overrides: Record<string, unknown> = {}) => ({
    agentId: 'agent-1',
    agent: {
      dataFields: [
        { key: 'email', label: 'Email', type: 'EMAIL', description: null },
        { key: 'age', label: 'Age', type: 'NUMBER', description: null },
      ],
    },
    messages: [
      { role: 'USER', content: 'hi my email is a@b.com' },
      { role: 'ASSISTANT', content: 'thanks' },
    ],
    collectedData: null,
    ...overrides,
  });

  describe('scheduleExtraction()', () => {
    it('stamps a future extractionDueAt on the session', async () => {
      mockPrisma.chatSession.update.mockResolvedValue({});
      const before = Date.now();
      await service.scheduleExtraction(sessionId);

      expect(mockPrisma.chatSession.update).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.chatSession.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: sessionId });
      expect(arg.data.extractionDueAt).toBeInstanceOf(Date);
      expect((arg.data.extractionDueAt as Date).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    it('swallows DB errors (must never break the reply)', async () => {
      mockPrisma.chatSession.update.mockRejectedValue(new Error('db down'));
      await expect(
        service.scheduleExtraction(sessionId),
      ).resolves.toBeUndefined();
    });
  });

  describe('extractForSession()', () => {
    it("returns 'empty' (no LLM) when the session is missing", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(null);
      expect(await service.extractForSession(sessionId)).toBe('empty');
      expect(mockAi.extractFields).not.toHaveBeenCalled();
    });

    it("returns 'empty' (no LLM) when the agent has no fields", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        baseSession({ agent: { dataFields: [] } }),
      );
      expect(await service.extractForSession(sessionId)).toBe('empty');
      expect(mockAi.extractFields).not.toHaveBeenCalled();
    });

    it("returns 'empty' (no LLM) when there are no messages", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        baseSession({ messages: [] }),
      );
      expect(await service.extractForSession(sessionId)).toBe('empty');
      expect(mockAi.extractFields).not.toHaveBeenCalled();
    });

    it("returns 'captured' and upserts mapped values", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(baseSession());
      mockAi.extractFields.mockResolvedValue({ email: 'a@b.com' });
      mockPrisma.collectedData.upsert.mockResolvedValue({});

      expect(await service.extractForSession(sessionId)).toBe('captured');
      // EMAIL → string, NUMBER → number mapping passed to the extractor.
      expect(mockAi.extractFields).toHaveBeenCalledWith(expect.any(String), [
        { key: 'email', label: 'Email', jsonType: 'string', description: null },
        { key: 'age', label: 'Age', jsonType: 'number', description: null },
      ]);
      expect(mockPrisma.collectedData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chatSessionId: sessionId },
          create: expect.objectContaining({
            agentId: 'agent-1',
            chatSessionId: sessionId,
            data: { email: 'a@b.com' },
          }),
        }),
      );
    });

    it('merges new values over previously captured data', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        baseSession({ collectedData: { data: { name: 'Dhruv' } } }),
      );
      mockAi.extractFields.mockResolvedValue({ email: 'a@b.com' });
      mockPrisma.collectedData.upsert.mockResolvedValue({});

      await service.extractForSession(sessionId);

      expect(mockPrisma.collectedData.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            data: { name: 'Dhruv', email: 'a@b.com' },
          }),
        }),
      );
    });

    it("returns 'empty' and writes nothing when no values are found", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(baseSession());
      mockAi.extractFields.mockResolvedValue({});
      expect(await service.extractForSession(sessionId)).toBe('empty');
      expect(mockPrisma.collectedData.upsert).not.toHaveBeenCalled();
    });

    it("returns 'retry' when the extractor couldn't run (null)", async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(baseSession());
      mockAi.extractFields.mockResolvedValue(null);
      expect(await service.extractForSession(sessionId)).toBe('retry');
      expect(mockPrisma.collectedData.upsert).not.toHaveBeenCalled();
    });

    it('drops SYSTEM rows and labels HUMAN_AGENT as [ASSISTANT] in the transcript', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        baseSession({
          messages: [
            { role: 'USER', content: 'hi my email is me@self.com' },
            { role: 'ASSISTANT', content: 'reach us at support@biz.com' },
            { role: 'SYSTEM', content: 'Dhruv took over. AI paused' },
            {
              role: 'HUMAN_AGENT',
              content: 'this is Dhruv, ping me at dhruv@biz.com',
            },
          ],
        }),
      );
      mockAi.extractFields.mockResolvedValue({ email: 'me@self.com' });
      mockPrisma.collectedData.upsert.mockResolvedValue({});

      await service.extractForSession(sessionId);

      const transcript = mockAi.extractFields.mock.calls[0][0] as string;
      expect(transcript).toContain('[USER]: hi my email is me@self.com');
      // A human teammate is the business's side — never tagged [USER].
      expect(transcript).toContain(
        '[ASSISTANT]: this is Dhruv, ping me at dhruv@biz.com',
      );
      // SYSTEM event lines never reach the LLM.
      expect(transcript).not.toContain('took over');
      expect(transcript).not.toContain('[SYSTEM]');
    });
  });

  describe('runDuePass()', () => {
    it('returns 0 and extracts nothing when none are due', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      const spy = jest.spyOn(service, 'extractForSession');
      expect(await service.runDuePass()).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it('clears the due marker for processed sessions and counts captures', async () => {
      const due1 = new Date('2026-06-20T10:00:00Z');
      const due2 = new Date('2026-06-20T10:01:00Z');
      mockPrisma.chatSession.findMany.mockResolvedValue([
        { id: 's1', extractionDueAt: due1 },
        { id: 's2', extractionDueAt: due2 },
      ]);
      jest
        .spyOn(service, 'extractForSession')
        .mockResolvedValueOnce('captured')
        .mockResolvedValueOnce('empty');
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });

      const captured = await service.runDuePass();

      expect(captured).toBe(1);
      // Both cleared (captured + empty are both "done"), race-safe on the value.
      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', extractionDueAt: due1 },
        data: { extractionDueAt: null },
      });
      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's2', extractionDueAt: due2 },
        data: { extractionDueAt: null },
      });
    });

    it("leaves the due marker (no clear) when extraction returns 'retry'", async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        { id: 's1', extractionDueAt: new Date('2026-06-20T10:00:00Z') },
      ]);
      jest.spyOn(service, 'extractForSession').mockResolvedValue('retry');

      expect(await service.runDuePass()).toBe(0);
      expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
    });

    it('queries only sessions whose due time has passed', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      await service.runDuePass();
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.extractionDueAt.not).toBeNull();
      expect(arg.where.extractionDueAt.lte).toBeInstanceOf(Date);
    });
  });

  describe('triggerDuePass()', () => {
    it('starts a background pass and is overlap-guarded (no concurrent pass)', async () => {
      // Make the pass hang so it stays "in flight" across the second call.
      let release!: () => void;
      mockPrisma.chatSession.findMany.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
      );

      expect(service.triggerDuePass()).toBe(true); // first starts
      expect(service.triggerDuePass()).toBe(false); // second is a no-op while running

      release();
      await new Promise((r) => setImmediate(r)); // let the pass settle + clear the guard

      expect(service.triggerDuePass()).toBe(true); // free again
    });
  });
});
