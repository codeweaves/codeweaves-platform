import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { APICallError } from "ai";
import { LlmService } from "../../../src/modules/ai/llm.service";
import { AiSdkService } from "../../../src/modules/ai/ai-sdk.service";
import { ProviderEventLogger } from "../../../src/common/events/provider.logger";
import { UsageMeterService } from "../../../src/modules/usage/usage-meter.service";

// Mock the AI SDK's generateText + streamText at module level.
jest.mock("ai", () => {
  const actual = jest.requireActual("ai");
  return {
    ...actual,
    generateText: jest.fn(),
    streamText: jest.fn(),
  };
});

import { generateText, streamText } from "ai";

const mockedGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;
const mockedStreamText = streamText as jest.MockedFunction<typeof streamText>;

/**
 * The real SDK always returns `steps` (one per model call). Mocks that only set
 * `usage` get a single matching step, as a one-call completion would.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerate = (r: any) =>
  mockedGenerateText.mockResolvedValue({
    steps: [{ usage: r.usage, providerMetadata: r.providerMetadata }],
    ...r,
  });

describe("LlmService", () => {
  let service: LlmService;
  const mockAiSdk = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getModel: jest.fn().mockReturnValue({} as any),
  };
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };
  const mockProviderLog = { log: jest.fn(), traced: jest.fn() };
  const mockMeter = { record: jest.fn() };

  beforeEach(async () => {
    env.clear();
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((k: string) => env.get(k));
    mockAiSdk.getModel.mockReturnValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: AiSdkService, useValue: mockAiSdk },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ProviderEventLogger, useValue: mockProviderLog },
        { provide: UsageMeterService, useValue: mockMeter },
      ],
    }).compile();
    service = moduleRef.get(LlmService);
  });

  const baseRequest = {
    modelId: "openai:gpt-4o-mini",
    systemPrompt: "You are helpful.",
    messages: [{ role: "user" as const, content: "Hi" }],
    temperature: 0.7,
    maxTokens: 500,
    organizationId: "org-1",
    agentId: "agent-1",
    feature: "chat" as const,
  };

  function makeStreamResult(chunks: string[], err?: unknown) {
    const usage = {
      inputTokens: 20,
      outputTokens: chunks.length,
      totalTokens: 20 + chunks.length,
    };
    return {
      get textStream() {
        return (async function* () {
          for (const c of chunks) yield c;
          if (err) throw err;
        })();
      },
      usage: Promise.resolve(usage),
      steps: Promise.resolve([{ usage, providerMetadata: undefined }]),
      finishReason: Promise.resolve("stop"),
      providerMetadata: Promise.resolve(undefined),
      text: Promise.resolve(chunks.join("")),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  describe("generateCompletion()", () => {
    it("returns a fully-normalised result on success", async () => {
      mockGenerate({
        text: "Hello there",
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          totalTokens: 60,
        },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await service.generateCompletion(baseRequest);
      expect(result).toMatchObject({
        text: "Hello there",
        usage: {
          inputTokens: 50,
          outputTokens: 10,
          totalTokens: 60,
        },
        finishReason: "stop",
        retryCount: 0,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns null cost: providers report usage, the usage meter prices it", async () => {
      mockGenerate({
        text: "Answer",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        providerMetadata: { openai: {} },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.cost).toBeNull();
    });

    it("reports the requested model id as the model that served the call", async () => {
      mockGenerate({
        text: "Answer",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.model).toBe("openai:gpt-4o-mini");
    });

    it("extracts cached tokens from inputTokenDetails (Anthropic shape)", async () => {
      mockGenerate({
        text: "Answer",
        usage: {
          inputTokens: 100,
          outputTokens: 5,
          totalTokens: 105,
          inputTokenDetails: { cacheReadTokens: 80 },
        },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(80);
    });

    it("extracts cached tokens from openai.cachedPromptTokens", async () => {
      mockGenerate({
        text: "Answer",
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: "stop",
        providerMetadata: { openai: { cachedPromptTokens: 70 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(70);
    });

    it("extracts cached tokens from snake-case prompt_tokens_details", async () => {
      mockGenerate({
        text: "Answer",
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: "stop",
        providerMetadata: {
          openai: { prompt_tokens_details: { cached_tokens: 60 } },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.cachedInputTokens).toBe(60);
    });

    it("extracts cached tokens from google.cachedContentTokenCount", async () => {
      mockGenerate({
        text: "Answer",
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
        finishReason: "stop",
        providerMetadata: { google: { cachedContentTokenCount: 45 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion({
        ...baseRequest,
        modelId: "gemini:gemini-2.5-flash",
      });
      expect(result.usage.cachedInputTokens).toBe(45);
    });

    it("sets totalTokens fallback when missing", async () => {
      mockGenerate({
        text: "x",
        usage: { inputTokens: 30, outputTokens: 5 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const result = await service.generateCompletion(baseRequest);
      expect(result.usage.totalTokens).toBe(35);
    });

    it("passes provider-specific options for gemini (thinkingBudget=0)", async () => {
      mockGenerate({
        text: "x",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        modelId: "gemini:gemini-2.5-flash",
      });
      const call = mockedGenerateText.mock.calls[0]![0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call as any).providerOptions?.google?.thinkingConfig).toEqual({
        thinkingBudget: 0,
        includeThoughts: false,
      });
    });

    it("passes promptCacheKey for openai", async () => {
      mockGenerate({
        text: "x",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({
        ...baseRequest,
        modelId: "openai:gpt-4o-mini",
      });
      const call = mockedGenerateText.mock.calls[0]![0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((call as any).providerOptions?.openai).toMatchObject({
        promptCacheKey: "agent-agent-1",
        promptCacheRetention: "24h",
      });
    });

    it("asks AiSdkService for the model by id only (no fallback settings, ADR-0011)", async () => {
      mockGenerate({
        text: "x",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion(baseRequest);
      expect(mockAiSdk.getModel).toHaveBeenCalledWith("openai:gpt-4o-mini");
    });

    it("wraps API errors into the same error type for caller inspection", async () => {
      // APICallError needs a url + requestBodyValues per its constructor signature.
      const apiErr = new APICallError({
        message: "rate limited",
        url: "https://api.openai.com",
        requestBodyValues: {},
        statusCode: 429,
      });
      mockedGenerateText.mockRejectedValue(apiErr);
      await expect(service.generateCompletion(baseRequest)).rejects.toBe(
        apiErr,
      );
    });

    it("rethrows generic errors", async () => {
      mockedGenerateText.mockRejectedValue(new Error("boom"));
      await expect(service.generateCompletion(baseRequest)).rejects.toThrow(
        "boom",
      );
    });

    it("preserves AbortError name", async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      mockedGenerateText.mockRejectedValue(err);
      await expect(service.generateCompletion(baseRequest)).rejects.toBe(err);
    });
  });

  describe("streamCompletion()", () => {
    it("yields text-delta + finish chunks", async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(["Hello ", "world"]));
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);

      const types = out.map((c) => (c as { type: string }).type);
      expect(types).toEqual(["text-delta", "text-delta", "finish"]);

      const finishChunk = out[out.length - 1] as {
        type: "finish";
        usage: { totalTokens: number };
        ttftMs: number | null;
        totalMs: number;
      };
      expect(finishChunk.usage.totalTokens).toBe(22);
      expect(finishChunk.ttftMs).not.toBeNull();
      expect(finishChunk.totalMs).toBeGreaterThanOrEqual(0);

      // The streaming path must emit its OUTBOUND completion event_log (the busy
      // path that was previously unlogged).
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "LLM_COMPLETION_COMPLETED",
          direction: "OUTBOUND",
        }),
      );
    });

    it("skips empty deltas", async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(["", "real", ""]));
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);
      const deltas = out.filter(
        (c) => (c as { type: string }).type === "text-delta",
      );
      expect(deltas).toHaveLength(1);
    });

    it("emits an error chunk on stream failure and rejects completion", async () => {
      mockedStreamText.mockReturnValue(
        makeStreamResult(["partial"], new Error("upstream boom")),
      );
      const handle = await service.streamCompletion(baseRequest);
      const out: unknown[] = [];
      for await (const c of handle.stream) out.push(c);

      const errorChunk = out.find(
        (c) => (c as { type: string }).type === "error",
      ) as { type: "error"; error: string };
      expect(errorChunk).toBeDefined();
      expect(errorChunk.error).toBe("upstream boom");

      await expect(handle.completion).rejects.toThrow("upstream boom");
    });

    it("completion resolves with normalised result after stream ends", async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(["a", "b"]));
      const handle = await service.streamCompletion(baseRequest);
      // Consume the stream first so the generator's resolveCompletion runs.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      const completion = await handle.completion;
      expect(completion.text).toBe("ab");
      expect(completion.usage.totalTokens).toBe(22);
    });

    it("honours AI_STREAM_TIMEOUT_MS override", async () => {
      env.set("AI_STREAM_TIMEOUT_MS", "5000");
      mockedStreamText.mockReturnValue(makeStreamResult(["x"]));
      const handle = await service.streamCompletion(baseRequest);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      // No exception → timeout config was parsed.
      await handle.completion;
    });
  });

  describe("usage metering (ADR-0012)", () => {
    const scoped = { ...baseRequest, chatSessionId: "cs-internal-1" };

    it("records one row per step of a tool-calling turn, with each step's tokens", async () => {
      mockGenerate({
        text: "done",
        usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 },
        steps: [
          {
            usage: {
              inputTokens: 500,
              outputTokens: 30,
              totalTokens: 530,
              inputTokenDetails: { cacheReadTokens: 256 },
            },
          },
          { usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } },
        ],
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await service.generateCompletion(scoped);

      expect(mockMeter.record).toHaveBeenCalledTimes(2);
      expect(mockMeter.record).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          organizationId: "org-1",
          agentId: "agent-1",
          chatSessionId: "cs-internal-1",
          provider: "openai",
          model: "gpt-4o-mini",
          feature: "CHAT",
          quantitySource: "PROVIDER_REPORTED",
          quantities: expect.objectContaining({
            inputTokens: 500,
            cachedInputTokens: 256,
            outputTokens: 30,
          }),
        }),
      );
      expect(mockMeter.record).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          quantities: expect.objectContaining({
            inputTokens: 90,
            outputTokens: 10,
          }),
        }),
      );
    });

    it("maps the summary feature and its INTERNAL channel", async () => {
      mockGenerate({
        text: "s",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        providerMetadata: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await service.generateCompletion({ ...scoped, feature: "summarization" });
      expect(mockMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({ feature: "SUMMARY", channel: "INTERNAL" }),
      );
    });

    it("records a finished stream once its steps resolve", async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(["Hello ", "world"]));
      const handle = await service.streamCompletion(scoped);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      await handle.completion;
      expect(mockMeter.record).toHaveBeenCalledTimes(1);
      expect(mockMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          chatSessionId: "cs-internal-1",
          quantities: expect.objectContaining({
            inputTokens: 20,
            outputTokens: 2,
          }),
          quantitySource: "PROVIDER_REPORTED",
        }),
      );
    });

    it("records an ESTIMATED row when a stream is cut off after tokens arrived", async () => {
      mockedStreamText.mockReturnValue(
        makeStreamResult(["12345678"], new Error("client gone")),
      );
      const handle = await service.streamCompletion(scoped);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      await expect(handle.completion).rejects.toThrow();
      expect(mockMeter.record).toHaveBeenCalledTimes(1);
      expect(mockMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          quantitySource: "ESTIMATED",
          // 8 streamed characters / 4 = 2 tokens.
          quantities: expect.objectContaining({ outputTokens: 2 }),
        }),
      );
    });

    it("records an ESTIMATED row when the consumer stops reading (visitor left)", async () => {
      mockedStreamText.mockReturnValue(makeStreamResult(["abcd", "efgh"]));
      const handle = await service.streamCompletion(scoped);
      // The controller `break`s out of its loop on client disconnect: no error
      // reaches the generator, only its `finally` runs.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        break;
      }
      expect(mockMeter.record).toHaveBeenCalledTimes(1);
      expect(mockMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          quantitySource: "ESTIMATED",
          quantities: expect.objectContaining({ outputTokens: 1 }),
        }),
      );
    });

    it("records nothing when a stream fails before any token", async () => {
      mockedStreamText.mockReturnValue(
        makeStreamResult([], new Error("refused")),
      );
      const handle = await service.streamCompletion(scoped);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _c of handle.stream) {
        // drain
      }
      await expect(handle.completion).rejects.toThrow();
      expect(mockMeter.record).not.toHaveBeenCalled();
    });
  });
});
