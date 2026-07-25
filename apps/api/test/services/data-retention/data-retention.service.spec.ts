import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataRetentionService } from '../../../src/services/data-retention.service';
import { EventLogRetentionService } from '../../../src/services/event-log-retention.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('DataRetentionService', () => {
  let service: DataRetentionService;

  const mockPrisma = { $executeRaw: jest.fn() };
  const mockConfig = { get: jest.fn() };
  const mockEventLogRetention = { cleanup: jest.fn() };

  const env = (vars: Record<string, string | undefined>) => {
    mockConfig.get.mockImplementation((key: string) => vars[key]);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    env({});
    mockPrisma.$executeRaw.mockResolvedValue(0);
    mockEventLogRetention.cleanup.mockResolvedValue({
      deleted: 0,
      skipped: true,
      retentionDays: 0,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        DataRetentionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventLogRetentionService, useValue: mockEventLogRetention },
      ],
    }).compile();
    service = moduleRef.get(DataRetentionService);
  });

  it('defaults: chat_traces armed at 90 days, audit_logs kept forever', async () => {
    const result = await service.run();

    // chat_traces swept with the 90-day default…
    expect(result.chatTraces).toEqual(
      expect.objectContaining({ skipped: false, retentionDays: 90 }),
    );
    // …audit_logs untouched until explicitly armed.
    expect(result.auditLogs).toEqual({
      deleted: 0,
      skipped: true,
      retentionDays: 0,
    });
    // One batched DELETE issued (chat_traces only).
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('respects configured windows for both tables', async () => {
    env({ CHAT_TRACE_RETENTION_DAYS: '30', AUDIT_LOG_RETENTION_DAYS: '400' });

    const result = await service.run();

    expect(result.chatTraces.retentionDays).toBe(30);
    expect(result.auditLogs).toEqual(
      expect.objectContaining({ skipped: false, retentionDays: 400 }),
    );
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('window=0 disables a sweep entirely (no DELETE issued)', async () => {
    env({ CHAT_TRACE_RETENTION_DAYS: '0' });

    const result = await service.run();

    expect(result.chatTraces).toEqual({
      deleted: 0,
      skipped: true,
      retentionDays: 0,
    });
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('treats a non-numeric window as disabled, not as the default', async () => {
    env({ CHAT_TRACE_RETENTION_DAYS: 'yes please' });

    const result = await service.run();

    expect(result.chatTraces.skipped).toBe(true);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps deleting in batches until a short batch signals completion', async () => {
    // Two full batches then a partial one → 3 statements, counts summed.
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(123);

    const result = await service.run();

    expect(result.chatTraces.deleted).toBe(10123);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('uses a cutoff of now minus the window', async () => {
    const before = Date.now();
    const result = await service.run();
    const after = Date.now();

    const cutoff = new Date(result.chatTraces.cutoff!).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - ninetyDays - 1000);
    expect(cutoff).toBeLessThanOrEqual(after - ninetyDays + 1000);
  });

  it('delegates event_logs to the existing retention service', async () => {
    mockEventLogRetention.cleanup.mockResolvedValue({
      deleted: 42,
      skipped: false,
      retentionDays: 365,
      cutoff: '2025-07-24T00:00:00.000Z',
    });

    const result = await service.run();

    expect(mockEventLogRetention.cleanup).toHaveBeenCalledTimes(1);
    expect(result.eventLogs.deleted).toBe(42);
  });
});
