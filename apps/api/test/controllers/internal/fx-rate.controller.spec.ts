import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FxRateController } from "../../../src/modules/usage/fx-rate.controller";
import { FxRateService } from "../../../src/modules/usage/fx-rate.service";
import { InternalSecretGuard } from "../../../src/guards/internal-secret.guard";
import { IS_PUBLIC_KEY } from "../../../src/decorators/public.decorator";

describe("FxRateController", () => {
  let controller: FxRateController;
  const refresh = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FxRateController],
      providers: [{ provide: FxRateService, useValue: { refresh } }],
    })
      // The internal-secret gate is exercised in the guard's own spec; here we
      // unit-test the controller→service delegation with the guard bypassed.
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(FxRateController);
  });

  it("delegates to the FX service and returns the stored rate", async () => {
    refresh.mockResolvedValue({ date: "2026-10-10", usdToInr: 96.64 });
    await expect(controller.run()).resolves.toEqual({
      date: "2026-10-10",
      usdToInr: 96.64,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("propagates a failure so the cron run shows as failed", async () => {
    refresh.mockRejectedValue(new Error("FX rate HTTP 503"));
    await expect(controller.run()).rejects.toThrow("FX rate HTTP 503");
  });

  it("is a cron endpoint: no JWT, gated by the internal secret", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FxRateController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, FxRateController)).toContain(
      InternalSecretGuard,
    );
  });
});
