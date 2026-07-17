import { Injectable, Logger } from '@nestjs/common';
import type { MessageRole } from '@prisma/client';
import type { ModelMessage } from 'ai';

import { PiiDetectionService } from '../pii/pii-detection.service';
import { PiiTokenizerService } from '../pii/pii-tokenizer.service';
import { PrismaService } from '../../services/prisma.service';

import { SummarizationService } from './summarization.service';

/** Max number of OLDER messages fed to the summariser. Caps cost. */
const MAX_MESSAGES_TO_SUMMARISE = 60;

export interface SummaryRefreshRequest {
  chatSessionId: string;
  organizationId: string;
  agentId: string;
  /** The window size the chat path used — we summarise what fell outside it. */
  maxContextMessages?: number;
  /** Same PII boundary as the chat path (summariser is an LLM call too). */
  piiRedactionEnabled?: boolean;
  traceId?: string;
}

/**
 * SummaryRefreshService: rebuilds `ChatSession.summary` OFF the reply path.
 *
 * DirectChatService calls `schedule()` fire-and-forget after a reply is
 * delivered, only when that turn's context assembly actually truncated
 * history. The refresh:
 *
 *   1. Skips if the summary is already current (generation marker =
 *      `summaryMessageCount` vs the live message count) — so a settled
 *      conversation costs exactly one summarisation per new message batch,
 *      and re-opens cost nothing.
 *   2. Skips if another refresh for the same session is in flight on this pod
 *      (cheap dedupe; cross-pod duplicates are harmless — last write wins on
 *      a single column).
 *   3. Summarises the messages OUTSIDE the recent window (chronological,
 *      capped at MAX_MESSAGES_TO_SUMMARISE) and persists the result.
 *
 * PII: HARD_DROP identifiers are always masked from the summariser's input
 * (legacy rows may predate ingestion masking); TOKENIZE-tier values become
 * placeholders when the agent's toggle is on — so the stored summary never
 * contains raw sensitive values either.
 *
 * Errors never propagate — a failed refresh just means the next truncating
 * turn schedules another attempt.
 */
@Injectable()
export class SummaryRefreshService {
  private readonly logger = new Logger(SummaryRefreshService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly summarization: SummarizationService,
    private readonly piiDetection: PiiDetectionService,
    private readonly piiTokenizer: PiiTokenizerService,
  ) {}

  /** Fire-and-forget entry point. Never throws, never blocks the caller. */
  schedule(req: SummaryRefreshRequest): void {
    void this.refresh(req).catch((err) => {
      this.logger.warn(
        `Summary refresh failed for session ${req.chatSessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async refresh(req: SummaryRefreshRequest): Promise<void> {
    if (this.inFlight.has(req.chatSessionId)) return;
    this.inFlight.add(req.chatSessionId);
    try {
      const messageCap = req.maxContextMessages ?? 20;
      const [total, session] = await Promise.all([
        this.prisma.chatMessage.count({
          where: { chatSessionId: req.chatSessionId },
        }),
        this.prisma.chatSession.findUnique({
          where: { id: req.chatSessionId },
          select: { summaryMessageCount: true },
        }),
      ]);
      // Nothing actually fell outside the window, or summary already current.
      if (total <= messageCap) return;
      if (session?.summaryMessageCount === total) return;

      const olderRows = await this.prisma.chatMessage.findMany({
        where: { chatSessionId: req.chatSessionId },
        orderBy: { createdAt: 'desc' },
        skip: messageCap,
        take: MAX_MESSAGES_TO_SUMMARISE,
        select: { role: true, content: true },
      });
      if (olderRows.length === 0) return;

      const piiCtx = req.piiRedactionEnabled
        ? await this.piiTokenizer.forSession(
            req.organizationId,
            req.chatSessionId,
          )
        : null;
      const olderMessages: ModelMessage[] = olderRows.reverse().map((m) => {
        let content = this.piiDetection.maskHardDrop(m.content);
        if (piiCtx) content = piiCtx.tokenize(content);
        return { role: roleToAiSdk(m.role), content };
      });
      if (piiCtx) void piiCtx.flush();

      const result = await this.summarization.summarize({
        messages: olderMessages,
        organizationId: req.organizationId,
        agentId: req.agentId,
        sessionId: req.chatSessionId,
        traceId: req.traceId,
      });
      const summary = result.summary.trim();
      if (!summary || summary === 'No substantive conversation yet.') return;

      await this.prisma.chatSession.update({
        where: { id: req.chatSessionId },
        data: { summary, summaryMessageCount: total },
      });
      this.logger.debug(
        `Summary refreshed for session ${req.chatSessionId} (${olderRows.length} older messages → ${summary.length} chars)`,
      );
    } finally {
      this.inFlight.delete(req.chatSessionId);
    }
  }
}

function roleToAiSdk(role: MessageRole): 'user' | 'assistant' {
  return role === 'USER' ? 'user' : 'assistant';
}
