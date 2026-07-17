import type { ConfigService } from '@nestjs/config';
import { EventLogRetentionService } from '../../src/services/event-log-retention.service';
import type { PrismaService } from '../../src/services/prisma.service';

describe('EventLogRetentionService', () => {
  let service: EventLogRetentionService;
  let retentionDays: string | undefined;
  const deleteMany = jest.fn();

  // Plain arrow (not jest.fn) so it survives jest.config resetMocks:true and
  // returns the value the test sets on `retentionDays`.
  const config = {
    get: () => retentionDays,
  } as unknown as ConfigService;

  const prisma = {
    eventLog: { deleteMany },
  } as unknown as PrismaService;

  beforeEach(() => {
    retentionDays = undefined;
    service = new EventLogRetentionService(prisma, config);
  });

  describe('cleanup', () => {
    it('is a no-op when retention is 0 (keep forever) — never deletes', async () => {
      retentionDays = '0';

      const result = await service.cleanup();

      expect(deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted: 0, skipped: true, retentionDays: 0 });
    });

    it('is a no-op when retention is unset', async () => {
      retentionDays = undefined;

      const result = await service.cleanup();

      expect(deleteMany).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it('is a no-op when retention is non-numeric / negative', async () => {
      retentionDays = '-5';

      const result = await service.cleanup();

      expect(deleteMany).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
    });

    it('deletes rows older than the cutoff when retention > 0 and returns the count', async () => {
      retentionDays = '30';
      deleteMany.mockResolvedValue({ count: 7 });

      const before = Date.now();
      const result = await service.cleanup();
      const after = Date.now();

      expect(deleteMany).toHaveBeenCalledTimes(1);
      const arg = deleteMany.mock.calls[0][0];
      const cutoff: Date = arg.where.createdAt.lt;
      expect(cutoff).toBeInstanceOf(Date);
      // Cutoff is ~30 days in the past.
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
  });
});
