import type { QuantitySource } from "@prisma/client";

/**
 * Audio length for STT providers that do not report it (Sarvam). Pure
 * functions over the uploaded bytes; no decoding, no dependencies.
 */

/** The widget records at most 60 s; a client-reported length is clamped to it. */
export const MAX_CLIENT_DURATION_MS = 60_000;

/**
 * Bit rate assumed when nothing can be measured. Browser MediaRecorder Opus
 * runs at roughly 32 to 128 kbps; 64 kbps is the middle. Rows priced from this
 * are marked ESTIMATED.
 */
const ESTIMATE_BITS_PER_SECOND = 64_000;

const OGG_CAPTURE = Buffer.from("OggS", "ascii");
const OPUS_HEAD = Buffer.from("OpusHead", "ascii");
const VORBIS_ID = Buffer.from("\x01vorbis", "latin1");
/** Granule -1: no packet ends on this page. */
const NO_GRANULE = 0xffffffffffffffffn;

/**
 * Length of an Ogg Opus (or Vorbis) file: the last page's granule position
 * over the stream's sample rate. Opus granules always count 48 kHz samples
 * and include the encoder pre-skip, which is not audio. Returns null when the
 * bytes are not a readable Ogg stream.
 */
export function oggDurationSeconds(buf: Buffer): number | null {
  if (buf.length < 28 || !buf.subarray(0, 4).equals(OGG_CAPTURE)) return null;

  const serial = buf.readUInt32LE(14);
  const firstPacket = buf.subarray(27 + buf[26]!);
  let rate: number;
  let preSkip = 0;
  if (
    firstPacket.subarray(0, 8).equals(OPUS_HEAD) &&
    firstPacket.length >= 12
  ) {
    rate = 48_000;
    preSkip = firstPacket.readUInt16LE(10);
  } else if (
    firstPacket.subarray(0, 7).equals(VORBIS_ID) &&
    firstPacket.length >= 16
  ) {
    rate = firstPacket.readUInt32LE(12);
  } else {
    return null;
  }
  if (rate <= 0) return null;

  // Walk back from the end to the last page of this stream with a granule.
  for (
    let at = buf.lastIndexOf(OGG_CAPTURE);
    at >= 0;
    at = at === 0 ? -1 : buf.lastIndexOf(OGG_CAPTURE, at - 1)
  ) {
    if (at + 27 > buf.length || buf[at + 4] !== 0) continue;
    if (buf.readUInt32LE(at + 14) !== serial) continue;
    const granule = buf.readBigUInt64LE(at + 6);
    if (granule === NO_GRANULE) continue;
    const samples = Number(granule) - preSkip;
    return samples > 0 ? samples / rate : 0;
  }
  return null;
}

/**
 * Length of a RIFF/WAVE file: data bytes over the byte rate in `fmt `. A
 * streamed WAV can carry a placeholder data size, so the size is capped at
 * the bytes actually present.
 */
export function wavDurationSeconds(buf: Buffer): number | null {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let byteRate = 0;
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && body + 12 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === "data") {
      if (byteRate <= 0) return null;
      return Math.min(size, buf.length - body) / byteRate;
    }
    // Chunks are word-aligned: an odd size has one pad byte.
    at = body + size + (size % 2);
  }
  return null;
}

export interface MeasuredAudio {
  seconds: number;
  source: QuantitySource;
}

/**
 * Best available length for billing:
 * 1. the container (Ogg granule, WAV header): MEASURED;
 * 2. the client's recording length, clamped to 0..60 s: MEASURED. Browser
 *    WebM and MP4 recordings often carry no usable duration;
 * 3. bytes over an assumed bit rate: ESTIMATED.
 */
export function measureAudioSeconds(
  audio: Buffer,
  mimeType: string,
  clientDurationMs?: number | null,
): MeasuredAudio {
  const mime = mimeType.toLowerCase();
  const fromContainer = mime.includes("ogg")
    ? oggDurationSeconds(audio)
    : mime.includes("wav")
      ? wavDurationSeconds(audio)
      : // A mislabelled upload is still worth a try.
        (oggDurationSeconds(audio) ?? wavDurationSeconds(audio));
  if (fromContainer !== null) {
    return { seconds: round3(fromContainer), source: "MEASURED" };
  }

  if (
    typeof clientDurationMs === "number" &&
    Number.isFinite(clientDurationMs) &&
    clientDurationMs > 0
  ) {
    const ms = Math.min(clientDurationMs, MAX_CLIENT_DURATION_MS);
    return { seconds: round3(ms / 1000), source: "MEASURED" };
  }

  return {
    seconds: round3((audio.length * 8) / ESTIMATE_BITS_PER_SECOND),
    source: "ESTIMATED",
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
