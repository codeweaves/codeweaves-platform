'use client';

/**
 * The notification chime.
 *
 * SYNTHESISED, not a file. Two short sine tones with a soft envelope — a
 * pleasant two-note "ding". This avoids shipping and fetching a binary asset
 * (no 404 risk, no decode step, no bytes on first paint) and it is the entire
 * sound in ~20 lines.
 *
 * Three things make this less trivial than "play a sound":
 *
 *  1. AUTOPLAY POLICY — browsers refuse to start audio until the page has seen
 *     a real user gesture. The dashboard is behind a login, but a tab restored
 *     from a previous session may not have been interacted with yet, so the very
 *     first (and most important) ding would be silently swallowed. We unlock the
 *     AudioContext on the first pointer/key event after load.
 *  2. COALESCING — five handovers arriving together must not sound like a
 *     machine gun.
 *  3. DEVICE, NOT ACCOUNT — whether sound is on belongs in localStorage, not the
 *     DB: the same person may want it on at their desk and off on a laptop.
 *
 * Module singleton (like the handover socket) so any component can ring it.
 */

const STORAGE_KEY = 'klivo:notification-sound';

/** Minimum gap between two audible dings. */
const THROTTLE_MS = 3000;

/** Two-note chime (E6 → A6) with per-note timing, in seconds. */
const NOTES: Array<{ freq: number; at: number; duration: number }> = [
  { freq: 1318.5, at: 0, duration: 0.16 },
  { freq: 1760.0, at: 0.11, duration: 0.22 },
];

/** Kept well below 1.0 — this fires while people are working. */
const PEAK_GAIN = 0.18;

let ctx: AudioContext | null = null;
let unlocked = false;
let lastPlayedAt = 0;
let listenersBound = false;

// ── Preference store (device-local, mirrored to React via useSyncExternalStore) ──

const prefListeners = new Set<() => void>();
let enabledCache: boolean | null = null;

function readEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (enabledCache !== null) return enabledCache;
  // Default ON: a team that turned handover on wants to hear about it.
  enabledCache = window.localStorage.getItem(STORAGE_KEY) !== 'off';
  return enabledCache;
}

export function subscribeSoundEnabled(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => prefListeners.delete(listener);
}

export function getSoundEnabled(): boolean {
  return readEnabled();
}

export function setSoundEnabled(value: boolean): void {
  if (typeof window === 'undefined') return;
  enabledCache = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Private mode / storage disabled — the in-memory value still applies for
    // this session.
  }
  prefListeners.forEach((l) => l());
  // Toggling ON is itself a user gesture — the cheapest possible moment to
  // satisfy the autoplay policy, so the first real notification can ring.
  if (value) void unlock();
}

// ── Playback ────────────────────────────────────────────────────────────────

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Satisfy the autoplay policy by resuming the context inside a user gesture.
 * Safe to call repeatedly.
 */
async function unlock(): Promise<void> {
  const context = getContext();
  if (!context) return;
  try {
    if (context.state === 'suspended') await context.resume();
    unlocked = context.state === 'running';
  } catch {
    // Still locked — the next gesture gets another go.
  }
}

/**
 * Arm the one-time unlock. Call once from the app shell; the listeners remove
 * themselves after the first gesture.
 */
export function primeNotificationSound(): void {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;
  const onGesture = () => {
    void unlock();
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
  window.addEventListener('pointerdown', onGesture, { once: true });
  window.addEventListener('keydown', onGesture, { once: true });
}

/**
 * Ring, unless the user turned it off or we rang moments ago.
 *
 * Never throws: this is called from a socket handler, and a browser audio quirk
 * must not take the notification pipeline down with it.
 */
export function playNotificationSound(): void {
  if (typeof window === 'undefined') return;
  if (!readEnabled()) return;

  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;

  const context = getContext();
  if (!context) return;

  // No gesture yet — nothing we can legally play. The toast still fires.
  if (!unlocked && context.state !== 'running') return;

  try {
    const startAt = context.currentTime;
    for (const note of NOTES) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;

      // Short attack then exponential decay — a hard cut would click audibly.
      const t0 = startAt + note.at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duration);

      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(t0);
      osc.stop(t0 + note.duration + 0.02);
    }
    lastPlayedAt = now;
  } catch {
    /* ignore — sound is never load-bearing */
  }
}
