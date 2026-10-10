import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";

import { Public } from "../../decorators/public.decorator";
import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { AlertsService, type AlertRunSummary } from "./alerts.service";

/**
 * Ops alert checks (ADR-0013). Same pattern and auth as the other cron
 * endpoints: an external scheduler POSTs every 15 minutes.
 *
 *   curl -X POST https://<api-host>/api/klivo/v1/internal/alerts/run \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public() — no JWT (the caller is a cron). InternalSecretGuard is the gate.
 */
@ApiTags("Internal")
@Public()
@UseGuards(InternalSecretGuard)
@Controller("internal/alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post("run")
  @ApiExcludeEndpoint()
  run(): Promise<AlertRunSummary> {
    return this.alerts.run();
  }
}
