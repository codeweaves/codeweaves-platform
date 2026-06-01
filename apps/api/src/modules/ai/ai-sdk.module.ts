import { Module } from '@nestjs/common';

import { AiSdkService } from './ai-sdk.service';
import { LlmService } from './llm.service';
import { TokenCounterService } from './token-counter.service';

/**
 * AI SDK module: the "leaf" module with lightweight, dependency-free utilities
 * that multiple higher-level modules consume.
 *
 *   - AiSdkService       — OpenRouter facade
 *   - LlmService         — generateText / streamText wrapper
 *   - TokenCounterService — js-tiktoken wrapper (pure utility, zero deps)
 *
 * TokenCounterService lives here (not in the richer AiModule) because agent
 * management code uses it for KB upload token counting, but it doesn't need
 * any of AiModule's heavier services (Prisma, context assembly, etc.).
 *
 * NOT global — each consumer module imports this explicitly, which keeps
 * dependencies visible in `imports: []` arrays and makes it trivial to swap
 * providers per module (e.g. test isolation).
 */
@Module({
  providers: [AiSdkService, LlmService, TokenCounterService],
  exports: [AiSdkService, LlmService, TokenCounterService],
})
export class AiSdkModule {}
