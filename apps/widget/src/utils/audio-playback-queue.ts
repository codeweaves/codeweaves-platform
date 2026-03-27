/**
 * AudioPlaybackQueue — sequential playback of base64 audio chunks (Story 5-20).
 *
 * Ported from apps/web/hooks/use-voice.ts AudioPlaybackQueue class.
 * Decodes base64 → Blob → Object URL → Audio element.
 * Waits for `canplaythrough` before calling play() to prevent first-word cutoff.
 */

export class AudioPlaybackQueue {
  private queue: { audio: string; format: string }[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private playing = false;
  private stopped = false;
  private onFinished: (() => void) | null = null;
  private streamComplete = false;

  constructor(onFinished: () => void) {
    this.onFinished = onFinished;
  }

  enqueue(audio: string, audioFormat: string): void {
    if (this.stopped) return;
    this.queue.push({ audio, format: audioFormat });
    if (!this.playing) {
      this.playNext();
    }
  }

  markStreamComplete(): void {
    this.streamComplete = true;
    if (!this.playing && this.queue.length === 0) {
      this.onFinished?.();
    }
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.revokeCurrentUrl();
    this.playing = false;
  }

  private playNext(): void {
    if (this.stopped) return;

    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      if (this.streamComplete) {
        this.onFinished?.();
      }
      return;
    }

    this.playing = true;
    try {
      const format = item.format.startsWith('audio/') ? item.format : `audio/${item.format}`;
      const byteChars = atob(item.audio);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: format });
      const url = URL.createObjectURL(blob);
      this.currentUrl = url;

      const audio = new Audio();
      this.currentAudio = audio;

      audio.onended = () => {
        this.revokeCurrentUrl();
        this.currentAudio = null;
        this.playNext();
      };

      audio.onerror = () => {
        this.revokeCurrentUrl();
        this.currentAudio = null;
        this.playNext();
      };

      // Wait for audio to buffer before playing — prevents first word cutoff
      audio.oncanplaythrough = () => {
        if (this.stopped) return;
        audio.play().catch(() => {
          this.revokeCurrentUrl();
          this.currentAudio = null;
          this.playNext();
        });
      };

      // Set src AFTER attaching handlers (not via constructor)
      audio.src = url;
    } catch {
      this.revokeCurrentUrl();
      this.currentAudio = null;
      this.playNext();
    }
  }

  private revokeCurrentUrl(): void {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }
}
