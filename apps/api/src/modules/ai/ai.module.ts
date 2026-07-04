import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma.module';
import { DataExtractionModule } from '../data-extraction.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RagModule } from '../rag/rag.module';

import { AiSdkModule } from './ai-sdk.module';
import { ContextAssemblyService } from './context-assembly.service';
import { DirectChatService } from './direct-chat.service';
import { PromptTemplateService } from './prompt-template.service';
import { HybridContextStrategy } from './strategies/hybrid-context.strategy';
import { SummarizationService } from './summarization.service';

/**
 * Main AI module: the single import every downstream consumer needs. Combines
 * the AI SDK facade + context assembly + direct-chat orchestrator + usage
 * tracking so that e.g. ChatModule just needs `imports: [AiModule]`.
 *
 * RagModule (chat-time retrieval) and IntegrationsModule (per-agent LLM tools)
 * are imported here because DirectChatService orchestrates both on the chat
 * hot path. UsageTrackingService moved down into AiSdkModule (re-exported via
 * it) so those modules can track usage without a module cycle.
 *
 * Note: AiTraceModule is registered globally from app.module.ts, so trace
 * services are injected automatically — no need to import here.
 */
@Module({
  imports: [
    PrismaModule,
    AiSdkModule,
    DataExtractionModule,
    RagModule,
    IntegrationsModule,
  ],
  providers: [
    ContextAssemblyService,
    DirectChatService,
    HybridContextStrategy,
    PromptTemplateService,
    SummarizationService,
  ],
  exports: [
    AiSdkModule,
    RagModule,
    IntegrationsModule,
    ContextAssemblyService,
    DirectChatService,
    HybridContextStrategy,
    PromptTemplateService,
    SummarizationService,
  ],
})
export class AiModule {}
