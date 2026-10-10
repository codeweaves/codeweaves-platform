import { Controller, Get, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  auditLogListQuerySchema,
  type AuditLogListQuery,
} from "@repo/validation";
import { CurrentUser } from "../../decorators/current-user.decorator";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import { Action, Resource } from "../../common/rbac/rbac.types";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import { AuditLogsService, type AuditLogPage } from "./audit-logs.service";
import { assertPlatformCaller } from "./ops-console.util";

/**
 * Ops console: who did what, across every organization. Read-only and
 * platform-only. Viewing is not itself audited; an export would be.
 */
@ApiTags("Ops console")
@ApiBearerAuth()
@Controller("admin/audit-logs")
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermission(Resource.AuditLog, Action.Read)
  @ApiOperation({
    summary:
      "List audit log rows, newest first (default window: last 7 days, max 90)",
  })
  @ApiResponse({ status: 200, description: "One page of audit rows" })
  @ApiResponse({
    status: 403,
    description: "Platform users with AuditLog:Read only",
  })
  list(
    @Query(new ZodValidationPipe(auditLogListQuerySchema))
    query: AuditLogListQuery,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AuditLogPage> {
    assertPlatformCaller(user);
    return this.auditLogs.list(query);
  }

  @Get("event-names")
  @RequirePermission(Resource.AuditLog, Action.Read)
  @ApiOperation({ summary: "Distinct audit event names from the last 30 days" })
  eventNames(
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ events: string[] }> {
    assertPlatformCaller(user);
    return this.auditLogs.eventNames();
  }
}
