import { Test, TestingModule } from '@nestjs/testing';
import { EventLogRetentionController } from '../../../src/controllers/internal/event-log-retention.controller';
import { InternalSecretGuard } from '../../../src/guards/internal-secret.guard';
import {
  EventLogRetentionService,
  type EventLogCleanupResult,
} from '../../../src/services/event-log-retention.service';

describe('EventLogRetentionController', () => {
  let controller: EventLogRetentionController;
  const cleanup = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [EventLogRetentionController],
      providers: [{ provide: EventLogRetentionService, useValue: { cleanup } }],
    })
      // The internal-secret gate is exercised in the guard's own spec; here we
      // unit-test the controller→service delegation with the guard bypassed.
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(EventLogRetentionController);
  });

  it('delegates to the retention service and returns its result', async () => {
    const outcome: EventLogCleanupResult = {
      deleted: 0,
      skipped: true,
      retentionDays: 0,
    };
    cleanup.mockResolvedValue(outcome);

    await expect(controller.cleanup()).resolves.toBe(outcome);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('propagates the deleted count when retention is armed', async () => {
    cleanup.mockResolvedValue({
      deleted: 42,
      skipped: false,
      retentionDays: 30,
      cutoff: new Date().toISOString(),
    });

    const result = await controller.cleanup();
    expect(result.deleted).toBe(42);
    expect(result.skipped).toBe(false);
  });
});
