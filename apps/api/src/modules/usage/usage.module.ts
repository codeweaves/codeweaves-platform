import { Global, Module } from "@nestjs/common";

import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { FxRateController } from "./fx-rate.controller";
import { FxRateService } from "./fx-rate.service";
import { PriceCatalogService } from "./price-catalog.service";
import { UsageMeterService } from "./usage-meter.service";

/**
 * Usage cost metering (ADR-0012): the price list, the usage meter every
 * provider call reports to, and the daily USD→INR rate.
 *
 * Global so the AI, voice, WhatsApp and email layers can inject the meter
 * without importing this module (and without import cycles).
 */
@Global()
@Module({
  controllers: [FxRateController],
  providers: [
    PriceCatalogService,
    UsageMeterService,
    FxRateService,
    InternalSecretGuard,
  ],
  exports: [PriceCatalogService, UsageMeterService, FxRateService],
})
export class UsageModule {}
