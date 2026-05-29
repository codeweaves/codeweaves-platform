import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AiClassifierService } from '../common/ai/ai-classifier.service';

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
  // Limits per invocation. The cron fires every 12 hours; 200 sessions per
  // run = up to 400/day, comfortably handling 10K conversations/month with
  // headroom. Raise if a backlog builds up; lower to cap LLM cost tighter.
  private static readonly MAX_PER_RUN = 200;
  private static readonly MIN_MESSAGES = 4;
  private static readonly QUIET_PERIOD_HOURS = 6;
  // Don't send the entire transcript to the LLM — last N messages is enough
  // signal for a topic label and bounds the token cost.
  private static readonly TRANSCRIPT_LAST_N_MESSAGES = 12;
  private static readonly TRANSCRIPT_CHAR_CAP = 8000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClassifierService,
  ) {}

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
        ConversationClassifierService.QUIET_PERIOD_HOURS * 60 * 60 * 1000,
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
      },
      orderBy: { lastMessageAt: 'asc' }, // oldest-quiet first — favours fairness
      take: ConversationClassifierService.MAX_PER_RUN,
      select: {
        id: true,
        agent: {
          select: {
            categoryKeywords: true,
            supportedLanguages: true,
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
