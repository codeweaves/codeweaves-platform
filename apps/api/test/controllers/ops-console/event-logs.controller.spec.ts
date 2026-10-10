import { ForbiddenException } from "@nestjs/common";
import { EventLogsController } from "../../../src/modules/ops-console/event-logs.controller";
import type { EventLogsService } from "../../../src/modules/ops-console/event-logs.service";
import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import {
  contextFor,
  misGrantedOrgUser,
  orgOwner,
  platformOps,
  realPermissionGuard,
} from "./ops-console-access.helper";

describe("EventLogsController", () => {
  const service = { list: jest.fn(), get: jest.fn() };
  let controller: EventLogsController;

  beforeEach(() => {
    controller = new EventLogsController(
      service as unknown as EventLogsService,
    );
  });

  const query = {
    page: 1,
    limit: 20,
    sortOrder: "desc" as const,
    success: false,
  };
  const id = "0b5c1f8e-3a52-4c1e-9d43-1f1b2a3c4d5e";

  it.each(["list", "get"] as const)("%s requires AuditLog:Read", (method) => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        EventLogsController.prototype[method],
      ),
    ).toEqual({ resource: "AuditLog", action: "Read" });
  });

  it("list delegates the parsed query", async () => {
    service.list.mockResolvedValue({ data: [], meta: {} });

    await controller.list(query, platformOps);

    expect(service.list).toHaveBeenCalledWith(query);
  });

  it("get delegates the id", async () => {
    service.get.mockResolvedValue({ id });

    await expect(controller.get(id, platformOps)).resolves.toEqual({ id });
    expect(service.get).toHaveBeenCalledWith(id);
  });

  it("the permission guard returns 403 to an org owner on the detail route", () => {
    expect(() =>
      realPermissionGuard().canActivate(
        contextFor(
          EventLogsController,
          EventLogsController.prototype.get,
          orgOwner,
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it("an ORG-scoped account is refused even if it holds AuditLog:Read", () => {
    expect(() => controller.list(query, misGrantedOrgUser)).toThrow(
      ForbiddenException,
    );
    expect(() => controller.get(id, misGrantedOrgUser)).toThrow(
      ForbiddenException,
    );
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });
});
