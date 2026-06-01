/**
 * AudioPlaybackQueue — sequential playback of base64 audio chunks.
 *
 * Uses the Web Audio API (AudioContext) with sample-accurate scheduling via
 * `nextScheduledTime` so consecutive chunks chain together with NO audible
 * gap. Critical for WS-streaming TTS where each sentence arrives as many
 * small chunks (10-50 chunks per sentence on ElevenLabs pcm_24000) — the
 * old HTMLAudioElement-per-chunk approach would have ~50ms of audible
 * stutter between every chunk.
 *
 * Two decoder paths:
 *   - PCM (`audio/pcm; rate=N`): raw 16-bit signed LE samples; converted
 *     directly to AudioBuffer via createBuffer + Int16-to-Float32 scaling.
 *     No decode latency (no parser state to maintain). Each chunk
 *     independently playable.
 *   - Compressed (`audio/mpeg`, `audio/wav`, `audio/ogg`...): batch HTTP
 *     path. Each chunk is a complete encoded file; `decodeAudioData()`
 *     parses it. Used when the agent is on the legacy non-streaming TTS
 *     path.
 *
 * MP3 priming-silence stripping is preserved for the batch path (Chrome /
 * Firefox / Edge expose the encoder's silence samples; we detect + skip).
 * PCM has no priming silence so the stripping is a no-op.
 */

const FIRST_CHUNK_LOOKAHEAD_SEC = 0.25;

function parsePcmSampleRate(mimeType: string): number | null {
  if (!mimeType || !mimeType.toLowerCase().startsWith('audio/pcm')) return null;
  const m = mimeType.match(/rate\s*=\s*(\d+)/i);
  return m ? parseInt(m[1] ?? '', 10) : 24000;
}

/**
 * Convert base64 → Uint8Array → AudioBuffer of 16-bit signed LE PCM samples.
 * Each chunk independently produces a valid AudioBuffer at the given sample
 * rate — sample-accurate scheduling makes the chained chunks gap-free.
 */
function pcmToAudioBuffer(ctx: AudioContext, base64: string, sampleRate: number): AudioBuffer {
  const byteChars = atob(base64);
  const sampleCount = Math.floor(byteChars.length / 2);
  const buf = ctx.createBuffer(1, sampleCount, sampleRate);
  const channel = buf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    const lo = byteChars.charCodeAt(i * 2);
    const hi = byteChars.charCodeAt(i * 2 + 1);
    const u16 = (hi << 8) | lo;
    const s16 = u16 >= 0x8000 ? u16 - 0x10000 : u16;
    channel[i] = s16 / 32768;
  }
  return buf;
}

/**
 * Scan the decoded buffer for the first non-zero sample. Most MP3 encoders
 * add ~1105 priming samples (~24ms @ 44.1kHz) of true zero-value silence.
 * Browsers (other than Safari) include those samples in the decoded buffer;
 * playing from offset 0 cuts the first consonant. Returning the offset
 * lets the caller pass it to `source.start(when, offset)`.
 */
function findLeadingSilence(audioBuffer: AudioBuffer): number {
  const channels: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const len = channels[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    for (const data of channels) {
      if (Math.abs(data[i] ?? 0) > 1e-4) {
        return i / audioBuffer.sampleRate;
      }
    }
  }
  return audioBuffer.duration;
}

export class AudioPlaybackQueue {
  private queue: { audio: string; format: string }[] = [];
  private audioContext: AudioContext | null = null;
  private nextScheduledTime = 0;
  private inFlightSources: AudioBufferSourceNode[] = [];
  private worker: Promise<void> | null = null;
  private playing = false;
  private stopped = false;
  private onFinished: (() => void) | null = null;
  private streamComplete = false;
  private resolvers: Array<() => void> = [];
  private finished = false;

  constructor(onFinished: () => void) {
    this.onFinished = onFinished;
  }

  private fireFinished(): void {
    if (this.finished) return;
    this.finished = true;
    this.onFinished?.();
  }

  enqueue(audio: string, audioFormat: string): void {
    if (this.stopped) return;
    this.queue.push({ audio, format: audioFormat });
    // Wake any worker waiting for chunks.
    const r = this.resolvers.shift();
    if (r) r();
    if (!this.playing) {
      this.playing = true;
      this.worker = this.processQueue();
    }
  }

  markStreamComplete(): void {
    this.streamComplete = true;
    // CRITICAL: wake any worker currently sleeping on a resolver. Without
    // this, the race goes:
    //   1. Last audio chunk enqueued → worker shifts + schedules it
    //   2. Worker loops back, queue empty, streamComplete still false →
    //      worker sleeps on `resolvers.push(resolve)`
    //   3. markStreamComplete fires → sets the flag but worker is asleep
    //   4. Worker never wakes → `onFinished` never fires → UI stuck on
    //      "speaker playing" indefinitely
    // Resolving any pending resolvers makes the worker loop one more time,
    // see streamComplete=true, and exit cleanly via the break path.
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!();
    }
    // If nothing is queued AND nothing is mid-scheduling, we're done.
    if (!this.playing && this.queue.length === 0) {
      this.fireFinished();
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    // Stop all in-flight buffer sources immediately.
    for (const src of this.inFlightSources) {
      try {
        src.stop(0);
      } catch {
        // already stopped
      }
    }
    this.inFlightSources = [];
    // Wake any worker waiting for chunks so it can exit cleanly.
    while (this.resolvers.length > 0) this.resolvers.shift()!();
    this.playing = false;
    this.nextScheduledTime = 0;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor: typeof AudioContext = ((globalThis as any).AudioContext ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).webkitAudioContext) as typeof AudioContext;
      this.audioContext = new Ctor();
    }
    return this.audioContext;
  }

  /**
   * Worker loop: consumes the queue serially, scheduling each chunk to play
   * starting at `nextScheduledTime`. The actual playback is non-blocking —
   * AudioContext schedules samples ahead of time, so the worker can decode
   * + schedule the NEXT chunk while the current one is still playing. This
   * is what eliminates the gap between chunks.
   *
   * Exits when the queue is empty AND `markStreamComplete()` was called.
   */
  private async processQueue(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume().catch(() => {});
    }

    try {
      while (!this.stopped) {
        const item = this.queue.shift();
        if (!item) {
          if (this.streamComplete) break; // queue drained and producer is done
          await new Promise<void>((resolve) => this.resolvers.push(resolve));
          continue;
        }

        try {
          let audioBuffer: AudioBuffer;
          let leadingSilence = 0;
          const pcmRate = parsePcmSampleRate(item.format);

          if (pcmRate !== null) {
            // Raw PCM — no decoder state, no priming silence.
            audioBuffer = pcmToAudioBuffer(ctx, item.audio, pcmRate);
          } else {
            // Compressed file — decode + strip MP3 priming silence.
            const byteChars = atob(item.audio);
            const buffer = new ArrayBuffer(byteChars.length);
            const view = new Uint8Array(buffer);
            for (let i = 0; i < byteChars.length; i++) {
              view[i] = byteChars.charCodeAt(i);
            }
            audioBuffer = await ctx.decodeAudioData(buffer);
            leadingSilence = findLeadingSilence(audioBuffer);
          }

          if (this.stopped) break;

          const now = ctx.currentTime;
          if (this.nextScheduledTime === 0) {
            // First chunk of this turn — small lookahead so audio hardware
            // has time to wake up before the first sample plays.
            this.nextScheduledTime = now + FIRST_CHUNK_LOOKAHEAD_SEC;
          }
          const startAt = Math.max(now, this.nextScheduledTime);

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          this.inFlightSources.push(source);
          source.onended = () => {
            const idx = this.inFlightSources.indexOf(source);
            if (idx >= 0) this.inFlightSources.splice(idx, 1);
          };
          source.start(startAt, leadingSilence);
          this.nextScheduledTime = startAt + (audioBuffer.duration - leadingSilence);
        } catch {
          // Per-chunk decode failures are non-fatal — skip and continue.
          continue;
        }
      }
    } finally {
      this.playing = false;
      // Wait for the LAST scheduled source to finish playing before reporting
      // the queue as finished — otherwise `onFinished` fires while audio is
      // still coming out of the speakers.
      if (this.audioContext && this.nextScheduledTime > this.audioContext.currentTime) {
        const wait = (this.nextScheduledTime - this.audioContext.currentTime) * 1000;
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!this.stopped) this.fireFinished();
    }
  }
}
