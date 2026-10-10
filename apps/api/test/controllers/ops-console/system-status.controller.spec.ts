import { ForbiddenException } from "@nestjs/common";
import { SystemStatusController } from "../../../src/modules/ops-console/system-status.controller";
import type { SystemStatusService } from "../../../src/modules/ops-console/system-status.service";
import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import {
  contextFor,
  misGrantedOrgUser,
  orgOwner,
  platformOps,
  realPermissionGuard,
} from "./ops-console-access.helper";

describe("SystemStatusController", () => {
  const service = { snapshot: jest.fn() };
  let controller: SystemStatusController;

  beforeEach(() => {
    controller = new SystemStatusController(
      service as unknown as SystemStatusService,
    );
  });

  it("requires AuditLog:Read", () => {
    expect(
      Reflect.getMetadata(PERMISSION_KEY, SystemStatusController.prototype.get),
    ).toEqual({ resource: "AuditLog", action: "Read" });
  });

  it("returns the snapshot for a platform caller", async () => {
    service.snapshot.mockResolvedValue({ jobs: [] });

    await expect(controller.get(platformOps)).resolves.toEqual({ jobs: [] });
  });

  it("the permission guard returns 403 to an org owner", () => {
    expect(() =>
      realPermissionGuard().canActivate(
        contextFor(
          SystemStatusController,
          SystemStatusController.prototype.get,
          orgOwner,
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it("an ORG-scoped account is refused even if it holds AuditLog:Read", () => {
    expect(() => controller.get(misGrantedOrgUser)).toThrow(ForbiddenException);
    expect(service.snapshot).not.toHaveBeenCalled();
  });
});
