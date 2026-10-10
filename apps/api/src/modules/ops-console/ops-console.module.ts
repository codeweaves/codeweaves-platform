import { Module } from "@nestjs/common";
import { AuditLogsController } from "./audit-logs.controller";
import { AuditLogsService } from "./audit-logs.service";
import { EventLogsController } from "./event-logs.controller";
import { EventLogsService } from "./event-logs.service";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusService } from "./system-status.service";

/**
 * Platform ops console, read side: audit log, event log and system status.
 * Every route needs AuditLog:Read (platform.super_admin, platform.ops).
 * PrismaModule, RedisModule and ConfigModule are global.
 */
@Module({
  controllers: [
    AuditLogsController,
    EventLogsController,
    SystemStatusController,
  ],
  providers: [AuditLogsService, EventLogsService, SystemStatusService],
})
export class OpsConsoleModule {}
