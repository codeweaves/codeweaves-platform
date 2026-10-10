import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";

import { AppLogger } from "../../common/logger/app-logger";
import { Action, Resource } from "../../common/rbac/rbac.types";
import {
  CurrentUser,
  type CurrentUserData,
} from "../../decorators/current-user.decorator";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import {
  usageQuerySchema,
  usageRankQuerySchema,
  usageTimeseriesQuerySchema,
  type UsageQuery,
  type UsageRankQuery,
  type UsageTimeseriesQuery,
} from "../../models/usage.dto";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import {
  UsageReportService,
  type AgentUsageRow,
  type ConversationUsage,
  type FxInfo,
  type OrganizationUsageRow,
  type UnitEconomics,
  type UsageSummary,
  type UsageTimeseries,
} from "./usage-report.service";

/**
 * Usage and cost reports for platform staff (ADR-0012, plan PR 4).
 *
 * `Usage:Read` is platform-only: no org role can hold it (role-purity trigger),
 * so an org user gets 403 from PermissionGuard before any query runs.
 *
 * Filters on every report: `from`, `to` (required; `YYYY-MM-DD` is a whole UTC
 * day, a date-time is an exact bound), `organizationId`, `agentId`, `provider`,
 * `feature`, `channel`, `billedTo`.
 */
@ApiTags("Admin: usage")
@ApiBearerAuth()
@Controller("admin/usage")
export class UsageReportController {
  private readonly log = new AppLogger(UsageReportController.name);

  constructor(private readonly reports: UsageReportService) {}

  @Get("summary")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({
    summary: "Cost totals and breakdowns by provider/model, feature, channel",
  })
  @ApiResponse({ status: 200, description: "Usage summary" })
  getSummary(
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
  ): Promise<UsageSummary> {
    return this.reports.getSummary(query);
  }

  @Get("timeseries")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Daily INR cost by feature" })
  getTimeseries(
    @Query(new ZodValidationPipe(usageTimeseriesQuerySchema))
    query: UsageTimeseriesQuery,
  ): Promise<UsageTimeseries> {
    return this.reports.getTimeseries(query);
  }

  @Get("organizations")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Organizations ranked by INR cost" })
  getOrganizations(
    @Query(new ZodValidationPipe(usageRankQuerySchema)) query: UsageRankQuery,
  ): Promise<{ fx: FxInfo; rows: OrganizationUsageRow[] }> {
    return this.reports.getOrganizations(query);
  }

  @Get("agents")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Agents ranked by INR cost" })
  getAgents(
    @Query(new ZodValidationPipe(usageRankQuerySchema)) query: UsageRankQuery,
  ): Promise<{ fx: FxInfo; rows: AgentUsageRow[] }> {
    return this.reports.getAgents(query);
  }

  @Get("unit-economics")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Cost per conversation and per voice minute" })
  getUnitEconomics(
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
  ): Promise<UnitEconomics> {
    return this.reports.getUnitEconomics(query);
  }

  @Get("conversations/:chatSessionId")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Every metered call of one conversation" })
  @ApiParam({ name: "chatSessionId", description: "Internal chat session id" })
  @ApiResponse({ status: 404, description: "No usage for this conversation" })
  getConversation(
    @Param("chatSessionId", new ParseUUIDPipe()) chatSessionId: string,
  ): Promise<ConversationUsage> {
    return this.reports.getConversation(chatSessionId);
  }

  /**
   * Streamed CSV of ledger rows in range (capped). Audit-logged as
   * USAGE_EXPORTED, even when the client aborts mid-download.
   */
  @Get("export.csv")
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({ summary: "Download usage rows as CSV" })
  @ApiResponse({ status: 200, description: "CSV attachment" })
  async exportCsv(
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, stream } = this.reports.prepareExport(query, user);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    // Wait on backpressure, but also on 'close': a client that hangs up never
    // emits 'drain', and a stuck promise would skip the generator's audit log.
    const write = (chunk: string) =>
      new Promise<void>((resolve) => {
        if (res.write(chunk)) return resolve();
        const done = () => {
          res.off("drain", done);
          res.off("close", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
      });

    try {
      for await (const chunk of stream) {
        if (res.writableEnded || res.destroyed) break; // client hung up
        await write(chunk);
      }
      res.end();
    } catch (error) {
      // Headers are already sent, so a JSON error cannot follow. Cut the
      // connection so the download shows as failed, not as a short file.
      this.log.error("exportCsv", "usage CSV stream failed", error);
      res.destroy();
    }
  }
}
