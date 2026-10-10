import { ForbiddenException } from "@nestjs/common";
import { AuditLogsController } from "../../../src/modules/ops-console/audit-logs.controller";
import type { AuditLogsService } from "../../../src/modules/ops-console/audit-logs.service";
import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import {
  contextFor,
  misGrantedOrgUser,
  orgOwner,
  platformOps,
  platformSupport,
  realPermissionGuard,
} from "./ops-console-access.helper";

describe("AuditLogsController", () => {
  const service = { list: jest.fn(), eventNames: jest.fn() };
  let controller: AuditLogsController;

  beforeEach(() => {
    controller = new AuditLogsController(
      service as unknown as AuditLogsService,
    );
  });

  const query = { page: 1, limit: 20, sortOrder: "desc" as const };

  it.each(["list", "eventNames"] as const)(
    "%s requires AuditLog:Read",
    (method) => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          AuditLogsController.prototype[method],
        ),
      ).toEqual({ resource: "AuditLog", action: "Read" });
    },
  );

  it("passes the parsed query to the service for a platform caller", async () => {
    service.list.mockResolvedValue({ data: [], meta: {} });

    await controller.list(query, platformOps);

    expect(service.list).toHaveBeenCalledWith(query);
  });

  it("returns the event-name options for a platform caller", async () => {
    service.eventNames.mockResolvedValue({ events: ["AGENT_CREATED"] });

    await expect(controller.eventNames(platformOps)).resolves.toEqual({
      events: ["AGENT_CREATED"],
    });
  });

  describe("access", () => {
    const guard = realPermissionGuard();

    it("the permission guard lets platform.ops through", () => {
      expect(
        guard.canActivate(
          contextFor(
            AuditLogsController,
            AuditLogsController.prototype.list,
            platformOps,
          ),
        ),
      ).toBe(true);
    });

    it("the permission guard returns 403 to an org owner", () => {
      expect(() =>
        guard.canActivate(
          contextFor(
            AuditLogsController,
            AuditLogsController.prototype.list,
            orgOwner,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it("the permission guard returns 403 to a platform role without AuditLog:Read", () => {
      expect(() =>
        guard.canActivate(
          contextFor(
            AuditLogsController,
            AuditLogsController.prototype.eventNames,
            platformSupport,
          ),
        ),
      ).toThrow(ForbiddenException);
    });

    it("an ORG-scoped account is refused even if it holds AuditLog:Read", async () => {
      expect(() => controller.list(query, misGrantedOrgUser)).toThrow(
        ForbiddenException,
      );
      expect(() => controller.eventNames(misGrantedOrgUser)).toThrow(
        ForbiddenException,
      );
      expect(service.list).not.toHaveBeenCalled();
      expect(service.eventNames).not.toHaveBeenCalled();
    });
  });
});
