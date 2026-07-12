import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma.module';

import { AiSdkService } from './ai-sdk.service';
import { LlmService } from './llm.service';
import { TokenCounterService } from './token-counter.service';
import { UsageTrackingService } from './usage-tracking.service';

/**
 * AI SDK module: the "base" module with utilities that multiple higher-level
 * modules consume.
 *
 *   - AiSdkService        — OpenRouter facade
 *   - LlmService          — generateText / streamText wrapper
 *   - TokenCounterService — js-tiktoken wrapper (pure utility, zero deps)
 *   - UsageTrackingService — batched LlmUsage writer (needs Prisma). Lives
 *     here (not AiModule) so RagModule can track embedding spend without
 *     importing AiModule — which would be a cycle, since AiModule imports
 *     RagModule for chat-time retrieval.
 *
 * TokenCounterService lives here (not in the richer AiModule) because agent
 * management code uses it for KB upload token counting, but it doesn't need
 * any of AiModule's heavier services (context assembly, etc.).
 *
 * NOT global — each consumer module imports this explicitly, which keeps
 * dependencies visible in `imports: []` arrays and makes it trivial to swap
 * providers per module (e.g. test isolation).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AiSdkService,
    LlmService,
    TokenCounterService,
    UsageTrackingService,
  ],
  exports: [
    AiSdkService,
    LlmService,
    TokenCounterService,
    UsageTrackingService,
  ],
})
export class AiSdkModule {}
