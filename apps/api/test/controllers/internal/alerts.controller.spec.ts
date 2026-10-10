import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AlertsController } from "../../../src/modules/monitoring/alerts.controller";
import { AlertsService } from "../../../src/modules/monitoring/alerts.service";
import { InternalSecretGuard } from "../../../src/guards/internal-secret.guard";
import { IS_PUBLIC_KEY } from "../../../src/decorators/public.decorator";

describe("AlertsController", () => {
  let controller: AlertsController;
  const run = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [{ provide: AlertsService, useValue: { run } }],
    })
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AlertsController);
  });

  it("runs the alert checks and returns the summary", async () => {
    const summary = {
      checked: 4,
      alertsSent: 1,
      suppressed: 2,
      deferred: 0,
      failedChecks: [],
    };
    run.mockResolvedValue(summary);

    await expect(controller.run()).resolves.toEqual(summary);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is a cron endpoint: no JWT, gated by the internal secret", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AlertsController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, AlertsController)).toContain(
      InternalSecretGuard,
    );
  });
});
