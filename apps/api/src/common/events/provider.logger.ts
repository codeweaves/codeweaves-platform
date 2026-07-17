import { Injectable } from '@nestjs/common';
import { TracerService } from '../tracer/tracer.service';
import { tracedCall, TracedCallOptions } from './traced-call';
import type { EventLogInput } from './event-log.types';

/**
 * Convenience wrapper for THIRD-PARTY outbound calls (LLM, STT/TTS, WhatsApp Graph,
 * n8n, Resend, Clerk, Supabase). Pre-binds the TracerService so call sites don't
 * pass it around. Provider name constants live in PROVIDERS below.
 *
 * Usage:
 *   const wamid = await this.providerLog.traced(
 *     { channel: 'WHATSAPP', provider: PROVIDERS.META_WHATSAPP, eventBase: 'META_WHATSAPP_SEND_TEXT',
 *       requestUrl: url, requestPayload: { to: masked, bodyChars: body.length },
 *       extract: (r) => ({ responsePayload: { wamid: r } }) },
 *     () => this.doSend(...),
 *   );
 *
 * All writes are fire-and-forget; the wrapped call's own errors are re-thrown
 * unchanged (see observability plan §2.1).
 */
@Injectable()
export class ProviderEventLogger {
  constructor(private readonly tracer: TracerService) {}

  /** Wrap a third-party call: emits <eventBase>_COMPLETED / _FAILED with timing. */
  traced<T>(opts: TracedCallOptions<T>, fn: () => Promise<T>): Promise<T> {
    return tracedCall<T>(this.tracer, opts, fn);
  }

  /** One-shot log for sites that already have the request + response in hand. */
  log(input: EventLogInput): void {
    void this.tracer.logEvent(input);
  }
}

/** Canonical provider labels for the event_logs.provider column. */
export const PROVIDERS = {
  ANTHROPIC: 'ANTHROPIC',
  OPENAI: 'OPENAI',
  GROQ: 'GROQ',
  GEMINI: 'GEMINI',
  OPENROUTER: 'OPENROUTER',
  CEREBRAS: 'CEREBRAS',
  ELEVENLABS: 'ELEVENLABS',
  SARVAM: 'SARVAM',
  DEEPGRAM: 'DEEPGRAM',
  META_WHATSAPP: 'META_WHATSAPP',
  N8N: 'N8N',
  RESEND: 'RESEND',
  CLERK: 'CLERK',
  SUPABASE: 'SUPABASE',
  AGENT_WEBHOOK: 'AGENT_WEBHOOK',
} as const;
