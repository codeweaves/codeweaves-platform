import { Test } from '@nestjs/testing';
import { UsageTrackingService } from '../../../src/modules/ai/usage-tracking.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;
  const mockPrisma = {
    llmUsage: { createMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsageTrackingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(UsageTrackingService);
    mockPrisma.llmUsage.createMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    jest.useRealTimers();
    // Best-effort drain.
    await service.onModuleDestroy().catch(() => undefined);
  });

  const baseEvent = () => ({
    organizationId: 'org-1',
    agentId: 'agent-1',
    sessionId: 'sess-1',
    messageId: 'msg-1',
    traceId: 'trace-1',
    model: 'gpt-4o-mini',
    requestedModel: 'gpt-4o-mini',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 20,
      reasoningTokens: undefined,
    },
    cost: 0.0005,
    feature: 'chat' as const,
    latencyMs: 800,
    cached: false,
    retryCount: 0,
    finishReason: 'stop',
  });

  it('queues a record and persists on flushNow()', async () => {
    service.record(baseEvent());
    expect(mockPrisma.llmUsage.createMany).not.toHaveBeenCalled();
    await service.flushNow();
    expect(mockPrisma.llmUsage.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.llmUsage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'org-1',
          agentId: 'agent-1',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cachedInputTokens: 20,
          reasoningTokens: null,
          cost: 0.0005,
          cached: false,
          retryCount: 0,
        }),
      ]),
    });
  });

  it('flushNow on empty buffer is a no-op', async () => {
    await service.flushNow();
    expect(mockPrisma.llmUsage.createMany).not.toHaveBeenCalled();
  });

  it('applies default values for cached/retryCount/finishReason', async () => {
    const event = baseEvent();
    delete (event as Partial<ReturnType<typeof baseEvent>>).cached;
    delete (event as Partial<ReturnType<typeof baseEvent>>).retryCount;
    delete (event as Partial<ReturnType<typeof baseEvent>>).finishReason;
    service.record(event);
    await service.flushNow();
    const data = mockPrisma.llmUsage.createMany.mock.calls[0]![0].data[0];
    expect(data).toMatchObject({
      cached: false,
      retryCount: 0,
      finishReason: null,
    });
  });

  it('handles null cachedInputTokens / reasoningTokens', async () => {
    const event = baseEvent();
    event.usage.cachedInputTokens = undefined as unknown as number;
    event.usage.reasoningTokens = undefined;
    service.record(event);
    await service.flushNow();
    const data = mockPrisma.llmUsage.createMany.mock.calls[0]![0].data[0];
    expect(data).toMatchObject({
      cachedInputTokens: null,
      reasoningTokens: null,
    });
  });

  it('auto-flushes when buffer reaches BATCH_SIZE (50)', async () => {
    for (let i = 0; i < 50; i++) service.record(baseEvent());
    // Let the void this.flush() microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockPrisma.llmUsage.createMany).toHaveBeenCalledTimes(1);
    expect(
      mockPrisma.llmUsage.createMany.mock.calls[0]![0].data,
    ).toHaveLength(50);
  });

  it('caps buffer growth: 1000 records do not all get persisted in one batch', async () => {
    // Auto-flush at BATCH_SIZE drains the buffer during the push loop, so
    // 1000 records arrive as multiple batches — never a single batch of
    // >500 (which is what MAX_BUFFER_SIZE guards against in the DB-down case).
    for (let i = 0; i < 1000; i++) service.record(baseEvent());
    // Drain any pending auto-flushes + explicitly flush the tail.
    await Promise.resolve();
    await Promise.resolve();
    await service.flushNow();
    for (const call of mockPrisma.llmUsage.createMany.mock.calls) {
      expect((call[0]?.data?.length ?? 0)).toBeLessThanOrEqual(500);
    }
  });

  it('swallows DB errors during flush (analytics tolerates gaps)', async () => {
    mockPrisma.llmUsage.createMany.mockRejectedValueOnce(new Error('db down'));
    service.record(baseEvent());
    await expect(service.flushNow()).resolves.toBeUndefined();
    // Batch dropped (no replay).
    await service.flushNow();
    expect(mockPrisma.llmUsage.createMany).toHaveBeenCalledTimes(1);
  });

  it('onModuleInit schedules a flush timer', () => {
    service.onModuleInit();
    expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('onModuleDestroy drains the buffer', async () => {
    service.record(baseEvent());
    await service.onModuleDestroy();
    expect(mockPrisma.llmUsage.createMany).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy logs error but does not throw on final flush failure', async () => {
    mockPrisma.llmUsage.createMany.mockRejectedValueOnce(new Error('boom'));
    service.record(baseEvent());
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
