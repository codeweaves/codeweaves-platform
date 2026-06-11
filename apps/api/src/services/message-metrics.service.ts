import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Strict, typed metrics for one chat message — the canonical shape that maps
 * 1:1 onto the `chat_message_metrics` columns. There is intentionally NO index
 * signature: adding a new metric requires adding a column + a field here, a
 * deliberate reviewed change. That is what stops the per-channel key drift that
 * the old free-form `metadata` JSON allowed.
 */
export interface MessageMetricsInput {
  inputType?: 'text' | 'voice' | null;
  streamed?: boolean | null;

  // backend / LLM timing (ms)
  responseLatencyMs?: number | null; // backend wall-clock: received -> reply sent
  llmLatencyMs?: number | null; // LLM generation time only
  timeToFirstTokenMs?: number | null;
  timeToLastTokenMs?: number | null;
  streamDurationMs?: number | null;
  totalChunks?: number | null;
  backendReceivedAt?: Date | null;
  backendRespondedAt?: Date | null;

  // LLM cost / tokens
  model?: string | null;
  traceId?: string | null;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  finishReason?: string | null;
  historyCount?: number | null;
  historyTruncated?: boolean | null;

  // STT (voice input)
  sttProvider?: string | null;
  sttLatencyMs?: number | null;
  detectedLanguage?: string | null;
  languageConfidence?: number | null;

  // TTS (voice reply)
  ttsProvider?: string | null;
  ttsProtocol?: string | null;
  ttsLatencyMs?: number | null;
  timeToFirstAudioMs?: number | null;
  voiceTotalLatencyMs?: number | null;
  totalSentences?: number | null;
  wsAvgFirstChunkLatencyMs?: number | null;
  wsTotalChunks?: number | null;
  wsTotalBytes?: number | null;

  // WhatsApp
  waInboundId?: string | null;
  waOutboundId?: string | null;
  delivered?: boolean | null;
  replyMode?: string | null;

  // errors
  errored?: boolean | null;
  errorCode?: string | null;
}

/**
 * The ONE place chat-message analytics metrics get written. Every channel
 * (text / voice / WhatsApp) routes through here, so column names can't diverge
 * per pipeline the way the old JSON keys did.
 */
@Injectable()
export class MessageMetricsService {
  private readonly logger = new Logger(MessageMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist typed metrics for a message. Best-effort and idempotent: a metrics
   * write must NEVER throw into the chat hot path — a failure here cannot be
   * allowed to break a user's reply. Upsert keyed on messageId so a retry or a
   * later delivery-status update is safe.
   */
  async record(messageId: string, createdAt: Date, input: MessageMetricsInput): Promise<void> {
    const data = this.strip(input);
    try {
      await this.prisma.chatMessageMetrics.upsert({
        where: { messageId },
        create: { messageId, createdAt, ...data },
        update: data,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record metrics for message ${messageId}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Normalize a legacy free-form `metadata` object into typed metrics,
   * reconciling the historical key aliases in ONE place:
   *   - timeToFirstTokenMs <- timeToFirstToken | llmTtftMs | ttftMs
   *   - ttsLatencyMs        <- averageTtsLatencyMs | ttsLatencyMs
   *   - llmLatencyMs        <- llmLatencyMs | latencyMs | (WhatsApp) responseLatencyMs
   *   - responseLatencyMs   <- responseLatencyMs (non-WhatsApp only)
   * Lets callers keep passing the object they already build while analytics
   * reads only the canonical columns.
   */
  fromMetadata(metadata: Record<string, unknown> | null | undefined): MessageMetricsInput {
    const m = metadata ?? {};
    return {
      inputType: m.inputType === 'text' || m.inputType === 'voice' ? m.inputType : null,
      // Every channel now writes these two distinctly: responseLatencyMs =
      // backend received->reply-sent; llmLatencyMs = the model's own time.
      responseLatencyMs: this.int(m.responseLatencyMs),
      llmLatencyMs: this.int(m.llmLatencyMs) ?? this.int(m.latencyMs),
      timeToFirstTokenMs: this.int(m.timeToFirstToken) ?? this.int(m.llmTtftMs) ?? this.int(m.ttftMs),
      timeToLastTokenMs: this.int(m.timeToLastToken),
      streamDurationMs: this.int(m.streamDurationMs),
      totalChunks: this.int(m.totalChunks),
      model: this.str(m.model),
      traceId: this.str(m.traceId),
      costUsd: this.dec(m.cost),
      inputTokens: this.int(m.inputTokens),
      outputTokens: this.int(m.outputTokens),
      totalTokens: this.int(m.totalTokens),
      cachedInputTokens: this.int(m.cachedInputTokens),
      reasoningTokens: this.int(m.reasoningTokens),
      finishReason: this.str(m.finishReason),
      historyCount: this.int(m.historyCount),
      historyTruncated: this.bool(m.historyTruncated),
      sttProvider: this.str(m.sttProvider),
      sttLatencyMs: this.int(m.sttLatencyMs),
      detectedLanguage: this.str(m.detectedLanguage),
      languageConfidence: this.dec(m.languageConfidence),
      ttsProvider: this.str(m.ttsProvider),
      ttsProtocol: this.str(m.ttsProtocol),
      ttsLatencyMs: this.int(m.averageTtsLatencyMs) ?? this.int(m.ttsLatencyMs),
      timeToFirstAudioMs: this.int(m.timeToFirstChunkMs),
      voiceTotalLatencyMs: this.int(m.totalLatencyMs),
      totalSentences: this.int(m.totalSentences),
      wsAvgFirstChunkLatencyMs: this.int(m.wsAvgFirstChunkLatencyMs),
      wsTotalChunks: this.int(m.wsTotalChunks),
      wsTotalBytes: this.int(m.wsTotalBytes),
      waInboundId: this.str(m.waInboundId),
      waOutboundId: this.str(m.waOutboundId),
      delivered: this.bool(m.delivered),
      replyMode: this.str(m.replyMode),
      errored: this.bool(m.error),
    };
  }

  /** Convenience: normalize + persist from a legacy metadata object. */
  async recordFromMetadata(
    messageId: string,
    createdAt: Date,
    metadata: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.record(messageId, createdAt, this.fromMetadata(metadata));
  }

  // ---- helpers: tolerant coercion (mirrors the SQL backfill guards) ----

  /** Drop `undefined` keys so an upsert only touches fields the caller set. */
  private strip(input: MessageMetricsInput): Partial<MessageMetricsInput> {
    return Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Partial<MessageMetricsInput>;
  }

  /** Integer columns (latency ms, tokens, counts): round; null on junk. */
  private int(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  /** Decimal columns (cost, confidence): keep precision; null on junk. */
  private dec(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private str(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  private bool(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  }
}
