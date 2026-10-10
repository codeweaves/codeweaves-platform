import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../decorators/current-user.decorator";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import { Action, Resource } from "../../common/rbac/rbac.types";
import {
  SystemStatusService,
  type SystemStatus,
} from "./system-status.service";
import { assertPlatformCaller } from "./ops-console.util";

/**
 * Ops console: cron liveness, provider error rates, unpriced usage and
 * DB / Redis readiness in one call. Platform-only.
 */
@ApiTags("Ops console")
@ApiBearerAuth()
@Controller("admin/system-status")
export class SystemStatusController {
  constructor(private readonly status: SystemStatusService) {}

  @Get()
  @RequirePermission(Resource.AuditLog, Action.Read)
  @ApiOperation({
    summary:
      "Cron jobs, provider health (last 60 min), unpriced usage (last 24 h), readiness",
  })
  get(@CurrentUser() user: CurrentUserData): Promise<SystemStatus> {
    assertPlatformCaller(user);
    return this.status.snapshot();
  }
}
