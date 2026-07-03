/**
 * Human-handover receive loop.
 *
 * While a conversation is escalated (a teammate is connected), the widget polls
 * the public /poll endpoint to receive the human's replies and learn when the
 * handover ends. This runs ONLY during the (rare, short) escalation window — so
 * the load scales with the number of LIVE human chats, not the number of
 * visitors.
 *
 * Since the realtime socket landed, this loop is the RECONCILE FALLBACK, not the
 * primary transport: the socket pushes a `message`/`handover` ping the instant
 * something changes and `poke()`s an immediate fetch, so the interval can run
 * slow while the socket is up (and drops back to fast if it disconnects).
 */

import { pollSession, type PollResponse } from './api-client';

export interface HandoverPollHandle {
  stop: () => void;
  /** Force an immediate poll (e.g. a socket ping just arrived). */
  poke: () => void;
}

/** Fallback cadence — used when no per-tick override is supplied. */
const POLL_INTERVAL_MS = 2500;

export function startHandoverPoll(
  agentId: string,
  sessionId: string,
  opts: {
    intervalMs?: number;
    /** Per-tick interval (e.g. slow while socket connected, fast when down). */
    getIntervalMs?: () => number;
    onUpdate: (data: PollResponse) => void;
    onError?: (err: unknown) => void;
  },
): HandoverPollHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Re-entrancy guard so a `poke()` mid-fetch can't double-fetch/advance. */
  let inFlight = false;
  // First poll fetches recent history (after=undefined); then we advance past
  // the newest message so each subsequent poll returns only what's new.
  let after: string | undefined;

  const nextInterval = (): number =>
    opts.getIntervalMs?.() ?? opts.intervalMs ?? POLL_INTERVAL_MS;

  function stop(): void {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(tick, nextInterval());
  }

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      const data = await pollSession(agentId, sessionId, after);
      if (stopped) return;
      if (data.messages.length > 0) {
        after = data.messages[data.messages.length - 1]!.createdAt;
      }
      // Decide to stop BEFORE handing data to the consumer: a throwing onUpdate
      // must never keep the loop alive after the handover has ended. (This was
      // the runaway-poll bug — resolve → NONE but polling continued.)
      const ended = data.handoverState === 'NONE';
      try {
        opts.onUpdate(data);
      } catch (err) {
        opts.onError?.(err);
      }
      if (ended) {
        stop(); // handover resolved → stop polling
        return; // finally still runs; schedule() below is skipped
      }
    } catch (err) {
      if (!stopped) opts.onError?.(err);
    } finally {
      inFlight = false;
    }
    schedule();
  }

  /** Fetch now (idempotent while a fetch is already in flight). */
  function poke(): void {
    if (stopped || inFlight) return;
    void tick();
  }

  void tick();
  return { stop, poke };
}
