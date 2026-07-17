import { Injectable } from '@nestjs/common';

import { AppLogger } from '../../../common/logger/app-logger';
import { PrismaService } from '../../../services/prisma.service';

import { ContextAssemblyService } from '../context-assembly.service';
import type {
  AssembleContextParams,
  AssembledContext,
} from '../interfaces/context.interfaces';

/**
 * HybridContextStrategy: recent-message sliding window + a running summary of
 * the messages that fell outside it. Best-of-both:
 *   - Recent messages: LLM sees exact text (high fidelity for current turn)
 *   - Older messages: compressed into a ~200-token summary (long-term context
 *     at ~10% of the token cost)
 *
 * ARCHITECTURE (see docs/plans/context-memory-rag-latency-plan.md §3):
 * the hot path only READS. The summary lives on `ChatSession.summary`,
 * refreshed asynchronously AFTER a reply is delivered (SummaryRefreshService,
 * fire-and-forget, debounced by an in-flight guard + generation marker). That
 * means:
 *
 *   - Zero summarisation LLM calls on the reply path — a long conversation
 *     never waits on a summary being (re)built.
 *   - Postgres is the cache: consistent across pods, survives restarts. The
 *     old per-pod in-memory Map (500 entries, lost on deploy) is gone.
 *   - The summary can lag by one turn right when messages first drop out of
 *     the window. The dropped message is ~20 turns old; a one-turn lag on
 *     compressing it is imperceptible — and the previous implementation
 *     discarded the summary entirely (injected into a field nobody read), so
 *     this is strictly better on both cost and quality.
 *
 * For conversations that fit the window this is a zero-cost passthrough.
 */
@Injectable()
export class HybridContextStrategy {
  private readonly log = new AppLogger(HybridContextStrategy.name);

  constructor(
    private readonly contextService: ContextAssemblyService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Assemble context; when the window truncated, attach the PERSISTED running
   * summary (if one exists yet) as `summaryBlock`. The orchestrator appends it
   * to the system prompt after the stable prefix — never here (that was the
   * discarded-summary bug).
   */
  async assemble(
    params: AssembleContextParams & {
      organizationId: string;
      agentId: string;
      traceId?: string;
    },
  ): Promise<AssembledContext> {
    const base = await this.contextService.assemble(params);

    // Fast path: everything fit — no summary needed, no extra query.
    if (!base.truncated && !base.olderMessagesExist) {
      return base;
    }

    // One indexed PK read. ~1-3ms against the same Postgres the context load
    // just hit; no LLM call ever happens here.
    try {
      const session = await this.prisma.chatSession.findUnique({
        where: { id: params.chatSessionId },
        select: { summary: true },
      });
      const summary = session?.summary?.trim();
      if (summary && summary !== 'No substantive conversation yet.') {
        this.log.debug('assemble', 'attached running summary', {
          chatSessionId: params.chatSessionId,
          chars: summary.length,
        });
        return { ...base, summaryBlock: summary };
      }
    } catch (err) {
      // Summary read failure is non-fatal — degrade to sliding-window only.
      this.log.warn(
        'assemble',
        `Summary read failed for session ${params.chatSessionId}: ${err instanceof Error ? err.message : 'unknown'}. Continuing without summary.`,
      );
    }
    return base;
  }
}
