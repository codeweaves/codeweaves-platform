import { Global, Module } from "@nestjs/common";

import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { FxRateController } from "./fx-rate.controller";
import { FxRateService } from "./fx-rate.service";
import { PriceAdminController } from "./price-admin.controller";
import { PriceAdminService } from "./price-admin.service";
import { PriceCatalogService } from "./price-catalog.service";
import { UsageMeterService } from "./usage-meter.service";
import { UsageReportController } from "./usage-report.controller";
import { UsageReportService } from "./usage-report.service";

/**
 * Usage cost metering (ADR-0012): the price list, the usage meter every
 * provider call reports to, the daily USD→INR rate, and the platform-only
 * usage and price pages of the admin console.
 *
 * Global so the AI, voice, WhatsApp and email layers can inject the meter
 * without importing this module (and without import cycles).
 */
@Global()
@Module({
  controllers: [FxRateController, UsageReportController, PriceAdminController],
  providers: [
    PriceCatalogService,
    UsageMeterService,
    FxRateService,
    UsageReportService,
    PriceAdminService,
    InternalSecretGuard,
  ],
  exports: [PriceCatalogService, UsageMeterService, FxRateService],
})
export class UsageModule {}
