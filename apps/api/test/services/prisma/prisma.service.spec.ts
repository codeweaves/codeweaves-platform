import { PrismaService } from '../../../src/services/prisma.service';

describe('PrismaService', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://user:pass@localhost:5432/db?schema=public';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('constructs successfully with DATABASE_URL set', () => {
    const service = new PrismaService();
    expect(service).toBeDefined();
  });

  it('throws on construction when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => new PrismaService()).toThrow(
      /DATABASE_URL.*not configured/i,
    );
  });

  it('schedules a heartbeat on onModuleInit', async () => {
    const service = new PrismaService();
    // Stub out the actual DB calls.
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$connect')
      .mockResolvedValue(undefined);
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }]);
    jest.useFakeTimers();
    try {
      await service.onModuleInit();
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      // Fire the heartbeat once + drain microtasks.
      jest.advanceTimersByTime(20_000);
    } finally {
      jest.useRealTimers();
      // Stub disconnect so destroy doesn't reach real Postgres.
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(service as any, '$disconnect')
        .mockResolvedValue(undefined);
      await service.onModuleDestroy();
    }
  });

  it('swallows warm-up query failures with a warning (no throw)', async () => {
    const service = new PrismaService();
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$connect')
      .mockResolvedValue(undefined);
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$queryRaw')
      .mockRejectedValue(new Error('db down'));
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$disconnect')
      .mockResolvedValue(undefined);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });

  it('onModuleDestroy clears the interval and disconnects', async () => {
    const service = new PrismaService();
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$connect')
      .mockResolvedValue(undefined);
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }]);
    const disconnectSpy = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy is safe to call without onModuleInit', async () => {
    const service = new PrismaService();
    const disconnectSpy = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, '$disconnect')
      .mockResolvedValue(undefined);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
