import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";

import { Public } from "../../decorators/public.decorator";
import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { FxRateService } from "./fx-rate.service";

/**
 * Daily USD→INR rate for cost reports (ADR-0012). Same pattern and auth as the
 * other cron endpoints: an external scheduler POSTs once a day.
 *
 *   curl -X POST https://<api-host>/api/klivo/v1/internal/fx/run \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public() — no JWT (the caller is a cron). InternalSecretGuard is the gate.
 */
@ApiTags("Internal")
@Public()
@UseGuards(InternalSecretGuard)
@Controller("internal/fx")
export class FxRateController {
  constructor(private readonly fx: FxRateService) {}

  @Post("run")
  @ApiExcludeEndpoint()
  run(): Promise<{ date: string; usdToInr: number }> {
    return this.fx.refresh();
  }
}
