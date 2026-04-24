import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma.module';

import { AiSdkModule } from './ai-sdk.module';
import { ContextAssemblyService } from './context-assembly.service';
import { DirectChatService } from './direct-chat.service';
import { PromptTemplateService } from './prompt-template.service';
import { HybridContextStrategy } from './strategies/hybrid-context.strategy';
import { SummarizationService } from './summarization.service';
import { UsageTrackingService } from './usage-tracking.service';

/**
 * Main AI module: the single import every downstream consumer needs. Combines
 * the AI SDK facade + context assembly + direct-chat orchestrator + usage
 * tracking so that e.g. ChatModule just needs `imports: [AiModule]`.
 *
 * Note: AiTraceModule is registered globally from app.module.ts, so trace
 * services are injected automatically — no need to import here.
 */
@Module({
  imports: [PrismaModule, AiSdkModule],
  providers: [
    ContextAssemblyService,
    DirectChatService,
    HybridContextStrategy,
    PromptTemplateService,
    SummarizationService,
    UsageTrackingService,
  ],
  exports: [
    AiSdkModule,
    ContextAssemblyService,
    DirectChatService,
    HybridContextStrategy,
    PromptTemplateService,
    SummarizationService,
    UsageTrackingService,
  ],
})
export class AiModule {}
