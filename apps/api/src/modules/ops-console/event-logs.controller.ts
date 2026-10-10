import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  eventLogListQuerySchema,
  type EventLogListQuery,
} from "@repo/validation";
import { CurrentUser } from "../../decorators/current-user.decorator";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import { Action, Resource } from "../../common/rbac/rbac.types";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import {
  EventLogsService,
  type EventLogDetail,
  type EventLogPage,
} from "./event-logs.service";
import { assertPlatformCaller } from "./ops-console.util";

/**
 * Ops console: what the system did (provider calls, channel traffic, failed
 * requests, cron runs). Read-only and platform-only.
 */
@ApiTags("Ops console")
@ApiBearerAuth()
@Controller("admin/event-logs")
export class EventLogsController {
  constructor(private readonly eventLogs: EventLogsService) {}

  @Get()
  @RequirePermission(Resource.AuditLog, Action.Read)
  @ApiOperation({
    summary:
      "List event log rows without payloads (default window: last 24 hours, max 30 days)",
  })
  @ApiResponse({ status: 200, description: "One page of slim event rows" })
  @ApiResponse({
    status: 403,
    description: "Platform users with AuditLog:Read only",
  })
  list(
    @Query(new ZodValidationPipe(eventLogListQuerySchema))
    query: EventLogListQuery,
    @CurrentUser() user: CurrentUserData,
  ): Promise<EventLogPage> {
    assertPlatformCaller(user);
    return this.eventLogs.list(query);
  }

  @Get(":id")
  @RequirePermission(Resource.AuditLog, Action.Read)
  @ApiOperation({
    summary:
      "One event log row with its payloads (credential headers stripped)",
  })
  @ApiResponse({ status: 404, description: "No such event" })
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<EventLogDetail> {
    assertPlatformCaller(user);
    return this.eventLogs.get(id);
  }
}
