import { Global, Module } from '@nestjs/common';

import { WidgetCorsCacheService } from './widget-cors-cache.service';

/**
 * Global module so both `WidgetCorsMiddleware` (read on every public widget
 * request) and `AgentsService.update` (invalidate on allowedDomains change)
 * can inject the same singleton without each module importing the other.
 *
 * Mirrors [[AgentCacheModule]].
 */
@Global()
@Module({
  providers: [WidgetCorsCacheService],
  exports: [WidgetCorsCacheService],
})
export class WidgetCorsCacheModule {}
