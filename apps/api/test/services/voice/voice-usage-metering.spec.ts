import type { ConfigService } from "@nestjs/config";

import type { ProviderEventLogger } from "../../../src/common/events/provider.logger";
import type { UsageMeterService } from "../../../src/modules/usage/usage-meter.service";
import { DeepgramProvider } from "../../../src/modules/voice/providers/deepgram.provider";
import { ElevenLabsProvider } from "../../../src/modules/voice/providers/elevenlabs.provider";
import { SarvamProvider } from "../../../src/modules/voice/providers/sarvam.provider";
import type {
  STTRequest,
  TTSRequest,
  VoiceUsageScope,
} from "../../../src/modules/voice/providers/voice-provider.interface";

/**
 * A scripted WebSocket. It opens on the next tick, records every frame sent,
 * and answers the way the provider does once a sentence is complete.
 */
jest.mock("undici", () => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    /** ElevenLabs closes with 1008 (bad key or voice) instead of sending audio. */
    static elevenLabsRejects = false;
    sent: Array<Record<string, unknown>> = [];
    private readonly listeners: Record<string, Array<(e: unknown) => void>> =
      {};
    private closed = false;

    constructor(public readonly url: URL) {
      FakeWebSocket.instances.push(this);
      setImmediate(() => this.emit("open", {}));
    }

    addEventListener(type: string, fn: (e: unknown) => void): void {
      (this.listeners[type] ??= []).push(fn);
    }

    send(raw: string): void {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      this.sent.push(frame);
      const reply = (data: unknown) =>
        setImmediate(() =>
          this.emit("message", { data: JSON.stringify(data) }),
        );
      if (this.url.host === "api.elevenlabs.io" && frame.text === "") {
        if (FakeWebSocket.elevenLabsRejects) {
          this.closed = true;
          setImmediate(() =>
            this.emit("close", { code: 1008, reason: "invalid api key" }),
          );
        } else {
          reply({
            audio: Buffer.from("pcm").toString("base64"),
            isFinal: true,
          });
        }
      }
      if (this.url.host === "api.sarvam.ai" && frame.type === "flush") {
        reply({
          type: "audio",
          data: { audio: Buffer.from("pcm").toString("base64") },
        });
        reply({ type: "event", data: { event_type: "final" } });
      }
    }

    close(): void {
      if (this.closed) return;
      this.closed = true;
      setImmediate(() => this.emit("close", { code: 1000 }));
    }

    private emit(type: string, event: unknown): void {
      for (const fn of this.listeners[type] ?? []) fn(event);
    }
  }
  return { WebSocket: FakeWebSocket };
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

const providerLog = {
  traced: <T>(_opts: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  log: () => undefined,
} as unknown as ProviderEventLogger;

const config = {
  get: (key: string) => (key.endsWith("_API_KEY") ? "test-key" : undefined),
} as unknown as ConfigService;

const scope: VoiceUsageScope = {
  organizationId: "org-1",
  agentId: "agent-1",
  chatSessionId: "chat-1",
  channel: "VOICE",
};

let record: jest.Mock;
let meter: UsageMeterService;

beforeEach(() => {
  record = jest.fn();
  meter = { record } as unknown as UsageMeterService;
});

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

const sttRequest = (over: Partial<STTRequest> = {}): STTRequest => ({
  audio: Buffer.alloc(16_000),
  audioFormat: "audio/webm",
  agentId: "agent-1",
  ...over,
});

const ttsRequest = (over: Partial<TTSRequest> = {}): TTSRequest => ({
  text: "Namaste, aap kaise hain?",
  language: "hi",
  agentId: "agent-1",
  usage: scope,
  ...over,
});

describe("STT usage reported by each provider", () => {
  it("Deepgram: billed seconds = metadata.duration x channels, with the request id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        metadata: {
          request_id: "dg-1",
          duration: 3.25,
          channels: 2,
          models: [],
        },
        results: {
          channels: [
            { alternatives: [{ transcript: "hi", confidence: 1, words: [] }] },
          ],
        },
      }),
    });

    const result = await new DeepgramProvider(config, providerLog).transcribe(
      sttRequest(),
    );

    expect(result.usage).toEqual({
      model: "nova-3",
      audioSeconds: 6.5,
      quantitySource: "PROVIDER_REPORTED",
      providerRequestId: "dg-1",
    });
  });

  it("ElevenLabs Scribe: audio_duration_secs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: "hello",
        language_code: "en",
        language_probability: 0.9,
        words: [],
        audio_duration_secs: 4.75,
        transcription_id: "el-1",
      }),
    });

    const result = await new ElevenLabsProvider(
      config,
      providerLog,
      meter,
    ).transcribe(sttRequest());

    expect(result.usage).toEqual({
      model: "scribe_v2",
      audioSeconds: 4.75,
      quantitySource: "PROVIDER_REPORTED",
      providerRequestId: "el-1",
    });
  });

  it("Sarvam: no duration in the response, so the widget's recording length is used (MEASURED)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: "sv-1",
        transcript: "namaste",
        language_code: "hi-IN",
        language_probability: 0.95,
        timestamps: null,
      }),
    });

    const result = await new SarvamProvider(
      config,
      providerLog,
      meter,
    ).transcribe(sttRequest({ durationMs: 5_400 }));

    expect(result.usage).toEqual({
      model: "saaras:v3",
      audioSeconds: 5.4,
      quantitySource: "MEASURED",
      providerRequestId: "sv-1",
    });
  });

  it("STT providers never write the ledger themselves (the caller records with the session)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: "sv-1",
        transcript: "namaste",
        language_code: "hi-IN",
        language_probability: 0.95,
        timestamps: null,
      }),
    });
    await new SarvamProvider(config, providerLog, meter).transcribe(
      sttRequest(),
    );
    expect(record).not.toHaveBeenCalled();
  });
});

describe("TTS usage recorded by each provider", () => {
  const characters = [..."Namaste, aap kaise hain?"].length;

  it("Sarvam HTTP: one row with the characters sent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: "sv-tts-1",
        audios: [Buffer.from("mp3").toString("base64")],
      }),
    });

    await new SarvamProvider(config, providerLog, meter).synthesize(
      ttsRequest(),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        ...scope,
        feature: "TTS",
        provider: "sarvam",
        model: "bulbul:v3",
        providerRequestId: "sv-tts-1",
        quantities: { characters },
        quantitySource: "MEASURED",
      }),
    );
  });

  it("counts characters as code points, not UTF-16 units", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: "r", audios: ["AA=="] }),
    });

    // Devanagari is 1 unit per character; an emoji outside the BMP is 2.
    await new SarvamProvider(config, providerLog, meter).synthesize(
      ttsRequest({ text: "नमस्ते 🙂" }),
    );

    expect(record.mock.calls[0][0].quantities).toEqual({ characters: 8 });
  });

  it("Sarvam HTTP: a failed call records nothing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "err",
      json: async () => ({
        error: { message: "boom", code: "internal_server_error" },
      }),
    });

    await expect(
      new SarvamProvider(config, providerLog, meter).synthesize(ttsRequest()),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("ElevenLabs HTTP: bills the characters sent, not the character-cost header (credits)", async () => {
    // Turbo on a legacy plan: 0.5 credits per character, so the header is
    // about half the character count. The price list is USD per character.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "character-cost": String(Math.floor(characters / 2)),
        "request-id": "el-req",
      }),
      arrayBuffer: async () => new ArrayBuffer(4),
    });

    await new ElevenLabsProvider(config, providerLog, meter).synthesize(
      ttsRequest({ language: "en" }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "elevenlabs",
        model: "eleven_turbo_v2_5",
        providerRequestId: "el-req",
        quantities: { characters },
        quantitySource: "MEASURED",
      }),
    );
  });

  it("ElevenLabs HTTP: counts the characters itself when the header is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(4),
    });

    await new ElevenLabsProvider(config, providerLog, meter).synthesize(
      ttsRequest({ language: "en" }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        quantities: { characters },
        quantitySource: "MEASURED",
      }),
    );
  });

  it("ElevenLabs WebSocket: counts the sentence frame, not the ' ' opener or the empty EOS", async () => {
    await drain(
      new ElevenLabsProvider(config, providerLog, meter).synthesizeStream(
        ttsRequest({ text: "Hello there" }),
      ),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        ...scope,
        feature: "TTS",
        provider: "elevenlabs",
        quantities: { characters: 11 },
        quantitySource: "MEASURED",
      }),
    );
  });

  it("ElevenLabs WebSocket: records nothing when the stream is rejected before any audio", async () => {
    const { WebSocket } = jest.requireMock<{
      WebSocket: { elevenLabsRejects: boolean };
    }>("undici");
    WebSocket.elevenLabsRejects = true;
    try {
      await drain(
        new ElevenLabsProvider(config, providerLog, meter).synthesizeStream(
          ttsRequest({ text: "Hello there" }),
        ),
      ).catch(() => undefined);
    } finally {
      WebSocket.elevenLabsRejects = false;
    }

    // The caller falls back to another provider, which records its own row.
    expect(record).not.toHaveBeenCalled();
  });

  it("Sarvam WebSocket stream: one row with the characters of the text frame", async () => {
    await drain(
      new SarvamProvider(config, providerLog, meter).synthesizeStream(
        ttsRequest({ text: "Namaste" }),
      ),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        provider: "sarvam",
        model: "bulbul:v3",
        quantities: { characters: 7 },
      }),
    );
  });

  it("Sarvam WebSocket session: one row per sentence sent", async () => {
    const session = await new SarvamProvider(
      config,
      providerLog,
      meter,
    ).openSynthesisSession({
      language: "hi",
      agentId: "agent-1",
      usage: scope,
    });

    await drain(session.synthesize("Pehla vaakya."));
    await drain(session.synthesize("Doosra."));
    await session.close();

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls.map((c) => c[0].quantities.characters)).toEqual([
      13, 7,
    ]);
    expect(record.mock.calls[0][0]).toEqual(
      expect.objectContaining({ chatSessionId: "chat-1", feature: "TTS" }),
    );
  });

  it("an editor preview is recorded as VOICE_PREVIEW with no organization", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: "r", audios: ["AA=="] }),
    });

    await new SarvamProvider(config, providerLog, meter).synthesizePreview(
      ttsRequest({
        agentId: "__preview__",
        usage: {
          channel: "DASHBOARD",
          feature: "VOICE_PREVIEW",
          organizationId: null,
          agentId: null,
        },
      }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        agentId: null,
        channel: "DASHBOARD",
        feature: "VOICE_PREVIEW",
        model: "bulbul:v3",
      }),
    );
  });

  it("with no scope passed, falls back to the request's agent on the VOICE channel", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: "r", audios: ["AA=="] }),
    });

    await new SarvamProvider(config, providerLog, meter).synthesize(
      ttsRequest({ usage: undefined }),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        agentId: "agent-1",
        channel: "VOICE",
        feature: "TTS",
      }),
    );
  });
});
