import type { ConfigService } from '@nestjs/config';
import { EventLogRetentionService } from '../../src/services/event-log-retention.service';
import type { PrismaService } from '../../src/services/prisma.service';

describe('EventLogRetentionService', () => {
  let service: EventLogRetentionService;
  let retentionDays: string | undefined;
  const executeRaw = jest.fn();

  // Plain arrow (not jest.fn) so it survives jest.config resetMocks:true and
  // returns the value the test sets on `retentionDays`.
  const config = {
    get: () => retentionDays,
  } as unknown as ConfigService;

  const prisma = {
    $executeRaw: executeRaw,
  } as unknown as PrismaService;

  beforeEach(() => {
    retentionDays = undefined;
    service = new EventLogRetentionService(prisma, config);
  });

  describe('cleanup', () => {
    it('is a no-op when retention is 0 (keep forever) — never deletes', async () => {
      retentionDays = '0';

      const result = await service.cleanup();

      expect(executeRaw).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted: 0, skipped: true, retentionDays: 0 });
    });

    it('is a no-op when retention is unset', async () => {
      retentionDays = undefined;

      const result = await service.cleanup();

      expect(executeRaw).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it('is a no-op when retention is non-numeric / negative', async () => {
      retentionDays = '-5';

      const result = await service.cleanup();

      expect(executeRaw).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
    });

    it('deletes rows older than the cutoff when retention > 0 and returns the count', async () => {
      retentionDays = '30';
      executeRaw.mockResolvedValue(7); // < batch size → single pass

      const before = Date.now();
      const result = await service.cleanup();
      const after = Date.now();

      expect(executeRaw).toHaveBeenCalledTimes(1);
      // Tagged template: call args are (stringsArray, cutoffDate, batchSize).
      const cutoff: Date = executeRaw.mock.calls[0][1];
      expect(cutoff).toBeInstanceOf(Date);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs + 1000);

      expect(result).toEqual(
        expect.objectContaining({
          deleted: 7,
          skipped: false,
          retentionDays: 30,
          cutoff: cutoff.toISOString(),
        }),
      );
    });

    it('loops in batches until a partial batch is returned', async () => {
      retentionDays = '30';
      // 5000 (full batch) → 5000 (full batch) → 42 (partial) = 3 calls, 10042 deleted.
      executeRaw
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(42);

      const result = await service.cleanup();

      expect(executeRaw).toHaveBeenCalledTimes(3);
      expect(result.deleted).toBe(10042);
      expect(result.skipped).toBe(false);
    });
  });
});
