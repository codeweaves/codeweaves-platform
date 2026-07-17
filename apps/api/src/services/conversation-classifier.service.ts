import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AiClassifierService } from '../common/ai/ai-classifier.service';
import { InternalEventLogger } from '../common/events/internal.logger';

/**
 * Conversation categorisation logic, invoked by a BullMQ repeatable job
 * (see `ConversationClassifierModule` — fires twice a day, 02:00 + 14:00 UTC).
 *
 * `runBatch()` picks up chat sessions that
 *   1. have been quiet for ≥ 6 hours (matches the documented session-
 *      inactivity window in `chat.service.ts` — by the time 6 hours pass, the
 *      conversation is effectively finalised and won't resume in the same row),
 *   2. have at least 4 messages (any less is too thin to label reliably),
 *   3. belong to an agent that has `categoryKeywords` configured, and
 *   4. haven't been classified yet (`categorizedAt IS NULL`).
 *
 * Each match gets one LLM round-trip via `AiClassifierService`, which assigns
 * a `category` and `detectedLanguage`. The pass is idempotent — re-running it
 * does nothing once `categorizedAt` is set, so duplicate cron invocations
 * (e.g., from manual triggers + the scheduled run colliding) are safe.
 *
 * Hard caps (`MAX_PER_RUN`, transcript length) protect us from a backlog
 * blowing up cost or runtime if the job has been off for a while.
 */
@Injectable()
export class ConversationClassifierService {
  // Limits per invocation. The cron fires once a day; 200 sessions per run
  // is comfortable for 10K conversations/month. Raise if a backlog builds
  // up; lower to cap LLM cost tighter.
  private static readonly MAX_PER_RUN = 200;
  private static readonly MIN_MESSAGES = 4;
  // Loose pre-filter — anything with no activity for the past hour is a
  // potential candidate. The precise per-agent `sessionLifetimeHours`
  // expiry check happens inside the loop, since lifetime is now per-row.
  private static readonly CANDIDATE_QUIET_HOURS = 1;
  // Don't send the entire transcript to the LLM — last N messages is enough
  // signal for a topic label and bounds the token cost.
  private static readonly TRANSCRIPT_LAST_N_MESSAGES = 12;
  private static readonly TRANSCRIPT_CHAR_CAP = 8000;

  private readonly logger = new Logger(ConversationClassifierService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClassifierService,
    private readonly internalLog: InternalEventLogger,
  ) {}

  /**
   * Kick off runBatch() in the BACKGROUND and return immediately, so the cron
   * caller (Supabase pg_cron, whose HTTP timeout is capped at 5s) gets an
   * instant ack instead of waiting out the LLM batch. Overlap-guarded: a no-op
   * if a pass is already running. Returns whether a new pass was started.
   */
  triggerBatch(): boolean {
    if (this.running) return false;
    this.running = true;
    const start = Date.now();
    this.internalLog.logStarted('CLASSIFIER_RUN_STARTED');
    void this.runBatch()
      .then((processed) => {
        this.logger.log(
          `Classifier run complete: processed ${processed} session(s).`,
        );
        this.internalLog.logCompleted('CLASSIFIER_RUN_COMPLETED', {
          latencyMs: Date.now() - start,
          metadata: { processed },
        });
      })
      .catch((err) => {
        this.logger.warn(
          `Classifier run failed: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        this.internalLog.logFailed('CLASSIFIER_RUN_FAILED', err, {
          metadata: { latencyMs: Date.now() - start },
        });
      })
      .finally(() => {
        this.running = false;
      });
    return true;
  }

  /**
   * Single batch pass — invoked by the internal /internal/classifier/run
   * endpoint. Returns the number of sessions that received an LLM-assigned
   * category this run. Sessions skipped for being too short still get a
   * `categorizedAt` stamp so they don't keep showing up in future runs.
   */
  async runBatch(): Promise<number> {
    // No AI-configured short-circuit here: status expiry runs regardless.
    // The individual ai.categorize / ai.detectLanguage calls return null when
    // the key is missing, so missing config just means no labels — sessions
    // still get their EXPIRED stamp on time.
    const cutoff = new Date(
      Date.now() -
        ConversationClassifierService.CANDIDATE_QUIET_HOURS * 60 * 60 * 1000,
    );

    const candidates = await this.prisma.chatSession.findMany({
      where: {
        categorizedAt: null,
        lastMessageAt: { not: null, lte: cutoff },
        // ALL quiet sessions belonging to a non-deleted agent — even ones
        // whose agent uses no classification at all. The expensive LLM calls
        // are gated per-dimension in the loop below; the cheap DB write
        // (status='EXPIRED' + categorizedAt stamp) happens for every match
        // so the dashboard's status filter is correct universally, not just
        // for agents that opted into classification.
        agent: { deletedAt: null },
        messages: { some: {} },
        // Never expire/classify a session that's mid-handover — a human may
        // still be working it. It becomes a candidate again once resolved
        // (handoverState back to NONE).
        handoverState: 'NONE',
      },
      orderBy: { lastMessageAt: 'asc' }, // oldest-quiet first — favours fairness
      take: ConversationClassifierService.MAX_PER_RUN,
      select: {
        id: true,
        createdAt: true,
        agent: {
          select: {
            categoryKeywords: true,
            supportedLanguages: true,
            sessionLifetimeHours: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, createdAt: true },
        },
      },
    });

    let processed = 0;
    for (const session of candidates) {
      // Per-row lifetime gate: skip sessions that the loose 1h pre-filter
      // caught but that haven't actually passed their agent's configured
      // lifetime yet (e.g. an agent with a 24h lifetime whose session went
      // quiet 2h ago — still nominally "live", not ready to classify).
      const lifetimeMs =
        session.agent.sessionLifetimeHours * 60 * 60 * 1000;
      const isPastLifetime =
        Date.now() - session.createdAt.getTime() > lifetimeMs;
      if (!isPastLifetime) continue;

      if (session.messages.length < ConversationClassifierService.MIN_MESSAGES) {
        // Mark as "classified" with no category so we don't re-evaluate this
        // session every tick — it's effectively too short to label.
        await this.markClassified(session.id, null, null);
        continue;
      }
      const transcript = this.buildTranscript(session.messages);
      // Each dimension respects its own enable-flag: a configured-keywords
      // agent that hasn't picked languages only pays for the category call,
      // and vice versa. An agent with neither pays nothing — both calls
      // are skipped, but the EXPIRED status flip still runs below.
      const keywords = session.agent.categoryKeywords;
      const languages = session.agent.supportedLanguages;
      const [category, detectedLanguage] = await Promise.all([
        keywords.length > 0
          ? this.ai.categorize(transcript, keywords)
          : Promise.resolve(null),
        languages.length > 0
          ? this.ai.detectLanguage(transcript, languages)
          : Promise.resolve(null),
      ]);
      await this.markClassified(session.id, category, detectedLanguage);
      processed += 1;
    }
    return processed;
  }

  private async markClassified(
    sessionId: string,
    category: string | null,
    detectedLanguage: string | null,
  ): Promise<void> {
    // We only get here if the session has been quiet 6h+ AND has reached the
    // age cap (the candidate query enforces both via lastMessageAt and the
    // chat layer's hard SESSION_LIFETIME_MS rotation). Flipping status to
    // EXPIRED here closes the loop for sessions where the visitor never
    // came back — `resolveOrCreateSession` handles the case where they do.
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        category,
        detectedLanguage,
        categorizedAt: new Date(),
        status: 'EXPIRED',
      },
    });
  }

  private buildTranscript(
    messages: Array<{ role: string; content: string; createdAt: Date }>,
  ): string {
    const tail = messages.slice(
      -ConversationClassifierService.TRANSCRIPT_LAST_N_MESSAGES,
    );
    const joined = tail
      .map((m) => `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    if (joined.length <= ConversationClassifierService.TRANSCRIPT_CHAR_CAP) {
      return joined;
    }
    return joined.slice(-ConversationClassifierService.TRANSCRIPT_CHAR_CAP);
  }
}
