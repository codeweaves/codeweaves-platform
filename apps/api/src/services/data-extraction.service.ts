import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import {
  AiClassifierService,
  type ExtractableField,
} from '../common/ai/ai-classifier.service';

import { PrismaService } from './prisma.service';

/** Outcome of one extraction attempt. `retry` leaves the session due. */
type ExtractionOutcome = 'captured' | 'empty' | 'retry';

/**
 * DataExtractionService: pulls an agent's configured data fields out of a
 * finished conversation and stores them in `CollectedData`.
 *
 * Scheduling is Postgres-only — NO Redis/queue:
 *   - `scheduleExtraction()` stamps `ChatSession.extractionDueAt = now + debounce`
 *     after each user-facing turn (each new turn pushes it forward = debounce).
 *   - A built-in timer (this service) calls `runDuePass()` every `pollMs`,
 *     processing every conversation whose due time has passed, then clearing
 *     the marker. The app runs this itself — nothing external to hit.
 *
 * Runs entirely off the reply hot path (zero chat latency) and costs zero Redis
 * commands. See docs/plans/agent-data-and-integrations-plan.md.
 *
 * Deployment note: the in-process timer works on any host that stays running
 * (local dev, always-on servers, Cloud Run with min-instances >= 1). If you
 * ever run somewhere that sleeps when idle and DON'T keep it warm, set
 * DATA_EXTRACT_POLL_ENABLED=false and have an external scheduler POST
 * /internal/data-extraction/run instead.
 */
@Injectable()
export class DataExtractionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataExtractionService.name);

  private static readonly MAX_PER_PASS = 200;
  private static readonly TRANSCRIPT_CHAR_CAP = 24000;
  private static readonly DEFAULT_DEBOUNCE_MS = 60_000;
  private static readonly DEFAULT_POLL_MS = 30_000;

  private readonly debounceMs: number;
  private readonly pollMs: number;
  private readonly pollEnabled: boolean;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClassifierService,
    private readonly config: ConfigService,
  ) {
    // Both default to sensible values; override in .env to watch it run fast
    // while testing (e.g. DATA_EXTRACT_DEBOUNCE_MS=5000, DATA_EXTRACT_POLL_MS=5000).
    this.debounceMs = this.readMsConfig(
      'DATA_EXTRACT_DEBOUNCE_MS',
      DataExtractionService.DEFAULT_DEBOUNCE_MS,
    );
    this.pollMs = this.readMsConfig(
      'DATA_EXTRACT_POLL_MS',
      DataExtractionService.DEFAULT_POLL_MS,
    );
    this.pollEnabled =
      this.config.get<string>('DATA_EXTRACT_POLL_ENABLED') !== 'false';
  }

  onModuleInit(): void {
    if (!this.pollEnabled || this.pollMs <= 0) {
      this.logger.log(
        'Data-extraction poller OFF (expecting an external scheduler to call /internal/data-extraction/run).',
      );
      return;
    }
    this.pollTimer = setInterval(() => this.triggerDuePass(), this.pollMs);
    // Never keep the process alive just for this timer.
    this.pollTimer.unref?.();
    this.logger.log(
      `Data-extraction poller ON — every ${this.pollMs}ms, debounce ${this.debounceMs}ms.`,
    );
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Kick off a due pass in the BACKGROUND and return immediately. Used by both
   * the in-process timer and the external cron endpoint so the HTTP caller
   * (e.g. Supabase pg_cron, whose timeout is capped at 5s) gets an instant ack
   * instead of waiting out the whole LLM batch.
   *
   * Overlap-guarded: if a pass is already running, this is a no-op — so an
   * every-minute cron can never start a second concurrent pass (which would
   * double-spend on the LLM). Returns whether a new pass was started.
   */
  triggerDuePass(): boolean {
    if (this.polling) return false;
    this.polling = true;
    void this.runDuePass()
      .catch((err) => {
        this.logger.warn(
          `Extraction pass failed: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      })
      .finally(() => {
        this.polling = false;
      });
    return true;
  }

  /**
   * Mark a conversation as due for extraction `debounceMs` from now. Called
   * fire-and-forget after each user-facing reply (only when the agent has
   * fields). Re-stamping on the next turn pushes the window forward — the
   * debounce. Fully fail-soft: a failure here must never affect the reply.
   */
  async scheduleExtraction(chatSessionId: string): Promise<void> {
    const dueAt = new Date(Date.now() + this.debounceMs);
    try {
      await this.prisma.chatSession.update({
        where: { id: chatSessionId },
        data: { extractionDueAt: dueAt },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to schedule extraction for session ${chatSessionId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Process every conversation whose extraction is due. Driven by the built-in
   * timer (and exposed via the internal endpoint). Idempotent.
   *
   * Returns the number of sessions that had data captured this pass.
   */
  async runDuePass(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.chatSession.findMany({
      where: { extractionDueAt: { not: null, lte: now } },
      orderBy: { extractionDueAt: 'asc' },
      take: DataExtractionService.MAX_PER_PASS,
      select: { id: true, extractionDueAt: true },
    });

    if (due.length === 0) {
      this.logger.debug('Extraction poll: nothing due.');
      return 0;
    }
    this.logger.log(`Extraction poll: ${due.length} session(s) due.`);

    let captured = 0;
    for (const session of due) {
      const outcome = await this.extractForSession(session.id).catch((err) => {
        this.logger.warn(
          `Extraction failed for session ${session.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        return 'retry' as const;
      });

      // 'retry' (extractor couldn't run) → leave the marker so a later pass
      // tries again. Otherwise clear it — but only if a newer turn hasn't
      // pushed the due time forward meanwhile (race-safe: updateMany matches
      // zero rows if it moved, so the session stays due and is reprocessed
      // next pass, merging the newer data).
      if (outcome === 'retry') continue;
      await this.prisma.chatSession.updateMany({
        where: { id: session.id, extractionDueAt: session.extractionDueAt },
        data: { extractionDueAt: null },
      });
      if (outcome === 'captured') captured += 1;
    }

    this.logger.log(
      `Extraction poll done: captured ${captured}/${due.length}.`,
    );
    return captured;
  }

  /**
   * Extract + persist captured data for one conversation. Pure: does NOT touch
   * the `extractionDueAt` marker (the caller owns that). Returns:
   *   - 'captured' — found values and upserted them
   *   - 'empty'    — ran successfully but nothing to capture (or no fields/msgs)
   *   - 'retry'    — the extractor couldn't run (unconfigured key / failed call)
   */
  async extractForSession(chatSessionId: string): Promise<ExtractionOutcome> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: chatSessionId },
      select: {
        agentId: true,
        agent: {
          select: {
            dataFields: {
              orderBy: { order: 'asc' },
              select: { key: true, label: true, type: true, description: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true },
        },
        collectedData: { select: { data: true } },
      },
    });

    if (!session || session.agent.dataFields.length === 0) return 'empty';
    if (session.messages.length === 0) return 'empty';

    const extractable: ExtractableField[] = session.agent.dataFields.map(
      (field) => ({
        key: field.key,
        label: field.label,
        jsonType: toJsonType(field.type),
        description: field.description,
      }),
    );

    // Nothing from the user → nothing of theirs to capture; skip the LLM call.
    if (!session.messages.some((m) => m.role === 'USER')) return 'empty';

    const transcript = this.buildTranscript(session.messages);
    const values = await this.ai.extractFields(transcript, extractable);

    // null = the extractor didn't actually run (unconfigured key or a failed
    // call). Retry rather than marking this conversation done, so a transient
    // blip doesn't drop a lead.
    if (values === null) return 'retry';
    if (Object.keys(values).length === 0) return 'empty';

    // Merge over anything captured earlier (latest value wins, e.g. a corrected
    // email), so re-extraction on a resumed conversation never drops fields.
    const existing =
      (session.collectedData?.data as Record<string, unknown> | null) ?? {};
    const merged = { ...existing, ...values };

    const now = new Date();
    await this.prisma.collectedData.upsert({
      where: { chatSessionId },
      create: {
        agentId: session.agentId,
        chatSessionId,
        data: merged as Prisma.InputJsonValue,
        extractedAt: now,
      },
      update: {
        data: merged as Prisma.InputJsonValue,
        extractedAt: now,
      },
    });

    this.logger.log(
      `Captured ${Object.keys(values).length} field(s) for session ${chatSessionId}.`,
    );
    return 'captured';
  }

  private buildTranscript(
    messages: Array<{ role: string; content: string }>,
  ): string {
    // Full conversation, labelled by speaker. Assistant turns are kept as
    // CONTEXT so the model can interpret short user replies — but the extraction
    // prompt forbids capturing values from them, and to read intent (only the
    // user's OWN data, e.g. "my email is…", never the business's "your email
    // is…?"). A detail may appear in the first message, so keep the whole thing;
    // only an extreme outlier exceeds the cap (then keep the most recent).
    const joined = messages
      .map((m) => `[${m.role === 'USER' ? 'USER' : 'ASSISTANT'}]: ${m.content}`)
      .join('\n');
    if (joined.length <= DataExtractionService.TRANSCRIPT_CHAR_CAP) {
      return joined;
    }
    return joined.slice(-DataExtractionService.TRANSCRIPT_CHAR_CAP);
  }

  private readMsConfig(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}

/** Map a stored DataFieldType to the JSON primitive the extractor emits. */
function toJsonType(type: string): ExtractableField['jsonType'] {
  if (type === 'NUMBER') return 'number';
  if (type === 'BOOLEAN') return 'boolean';
  // STRING, EMAIL, PHONE, DATE all serialise as strings.
  return 'string';
}
