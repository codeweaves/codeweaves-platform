import { Module } from '@nestjs/common';

import { LoggerModule } from '../../common/logger/logger.module';
import { PrismaModule } from '../prisma.module';
import { AiSdkModule } from '../ai/ai-sdk.module';

import { ChunkingService } from './chunking.service';
import { DocumentIngestionService } from './document-ingestion.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { EmbeddingService } from './embedding.service';
import { RagRetrievalService } from './rag-retrieval.service';
import { UrlFetcherService } from './url-fetcher.service';

/**
 * RagModule: the agent knowledge-base pipeline.
 *
 *   Ingestion:  upload/URL → extract → chunk (strategy) → embed → pgvector
 *   Retrieval:  query → embed → vector | hybrid(RRF) search → cited context
 *
 * RagRetrievalService is exported for DirectChatService (AiModule) to inject
 * retrieval into the chat hot path.
 */
@Module({
  imports: [PrismaModule, AiSdkModule, LoggerModule],
  controllers: [DocumentsController],
  providers: [
    ChunkingService,
    EmbeddingService,
    UrlFetcherService,
    DocumentIngestionService,
    DocumentsService,
    RagRetrievalService,
  ],
  exports: [RagRetrievalService, ChunkingService, EmbeddingService],
})
export class RagModule {}
