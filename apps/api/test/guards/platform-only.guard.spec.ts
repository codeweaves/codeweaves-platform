import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessScope } from "@prisma/client";

import { PlatformOnlyGuard } from "../../src/guards/platform-only.guard";
import { PriceAdminController } from "../../src/modules/usage/price-admin.controller";
import { UsageReportController } from "../../src/modules/usage/usage-report.controller";

describe("PlatformOnlyGuard", () => {
  const guard = new PlatformOnlyGuard();
  const ctx = (user: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it("lets platform staff through", () => {
    expect(guard.canActivate(ctx({ accessScope: AccessScope.PLATFORM }))).toBe(
      true,
    );
  });

  it("rejects an org user, even one holding the permission by mistake", () => {
    expect(() =>
      guard.canActivate(
        ctx({ accessScope: AccessScope.ORG, organizationId: "org-1" }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("rejects a request with no user", () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it.each([
    ["UsageReportController", UsageReportController],
    ["PriceAdminController", PriceAdminController],
  ])("is applied to every route of %s", (_name, controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
      PlatformOnlyGuard,
    );
  });
});
