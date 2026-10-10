import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DataRetentionController } from "../../../src/controllers/internal/data-retention.controller";
import { DataRetentionService } from "../../../src/services/data-retention.service";
import { HeartbeatService } from "../../../src/modules/monitoring/heartbeat.service";
import { InternalSecretGuard } from "../../../src/guards/internal-secret.guard";
import { IS_PUBLIC_KEY } from "../../../src/decorators/public.decorator";

describe("DataRetentionController", () => {
  let controller: DataRetentionController;
  const run = jest.fn();
  const ping = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DataRetentionController],
      providers: [
        { provide: DataRetentionService, useValue: { run } },
        { provide: HeartbeatService, useValue: { ping } },
      ],
    })
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DataRetentionController);
  });

  const result = {
    chatTraces: { deleted: 4, skipped: false, retentionDays: 90 },
    auditLogs: { deleted: 0, skipped: true, retentionDays: 0 },
    eventLogs: { deleted: 0, skipped: true, retentionDays: 0 },
  };

  it("returns the sweep result and pings the heartbeat after it finished", async () => {
    run.mockResolvedValue(result);

    await expect(controller.run()).resolves.toEqual(result);
    expect(ping).toHaveBeenCalledWith("RETENTION");
  });

  it("pings the heartbeat on an idle sweep that deleted nothing", async () => {
    run.mockResolvedValue({
      ...result,
      chatTraces: { deleted: 0, skipped: false, retentionDays: 90 },
    });

    await controller.run();
    expect(ping).toHaveBeenCalledWith("RETENTION");
  });

  it("does not ping the heartbeat when the sweep fails", async () => {
    run.mockRejectedValue(new Error("db down"));

    await expect(controller.run()).rejects.toThrow("db down");
    expect(ping).not.toHaveBeenCalled();
  });

  it("is a cron endpoint: no JWT, gated by the internal secret", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DataRetentionController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DataRetentionController),
    ).toContain(InternalSecretGuard);
  });
});
