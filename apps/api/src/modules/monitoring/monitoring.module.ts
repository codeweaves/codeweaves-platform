import { Global, Module } from "@nestjs/common";

import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";
import { HeartbeatService } from "./heartbeat.service";
import { SlackNotifierService } from "./slack-notifier.service";

/**
 * External monitoring and ops alerts (ADR-0013): Better Stack cron heartbeats,
 * the Slack alert channel, and the 15-minute alert job.
 *
 * Global so every cron service can inject HeartbeatService without importing
 * this module.
 */
@Global()
@Module({
  controllers: [AlertsController],
  providers: [
    SlackNotifierService,
    HeartbeatService,
    AlertsService,
    InternalSecretGuard,
  ],
  exports: [SlackNotifierService, HeartbeatService],
})
export class MonitoringModule {}
