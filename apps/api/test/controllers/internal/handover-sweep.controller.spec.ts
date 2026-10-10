import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { HandoverSweepController } from "../../../src/controllers/internal/handover-sweep.controller";
import { HandoverService } from "../../../src/services/handover.service";
import { HeartbeatService } from "../../../src/modules/monitoring/heartbeat.service";
import { InternalSecretGuard } from "../../../src/guards/internal-secret.guard";
import { IS_PUBLIC_KEY } from "../../../src/decorators/public.decorator";

describe("HandoverSweepController", () => {
  let controller: HandoverSweepController;
  const sweepIdleHandovers = jest.fn();
  const ping = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HandoverSweepController],
      providers: [
        { provide: HandoverService, useValue: { sweepIdleHandovers } },
        { provide: HeartbeatService, useValue: { ping } },
      ],
    })
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(HandoverSweepController);
  });

  it("returns the sweep result and pings the heartbeat after it finished", async () => {
    sweepIdleHandovers.mockResolvedValue({ resolved: 3 });

    await expect(controller.sweep()).resolves.toEqual({ resolved: 3 });
    expect(ping).toHaveBeenCalledWith("HANDOVER_SWEEP");
  });

  it("pings the heartbeat on an idle sweep that resolved nothing", async () => {
    sweepIdleHandovers.mockResolvedValue({ resolved: 0 });

    await controller.sweep();
    expect(ping).toHaveBeenCalledWith("HANDOVER_SWEEP");
  });

  it("does not ping the heartbeat when the sweep fails", async () => {
    sweepIdleHandovers.mockRejectedValue(new Error("db down"));

    await expect(controller.sweep()).rejects.toThrow("db down");
    expect(ping).not.toHaveBeenCalled();
  });

  it("is a cron endpoint: no JWT, gated by the internal secret", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HandoverSweepController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HandoverSweepController),
    ).toContain(InternalSecretGuard);
  });
});
