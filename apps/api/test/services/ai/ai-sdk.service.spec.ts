import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  AiSdkService,
  parseModelId,
} from "../../../src/modules/ai/ai-sdk.service";

describe("parseModelId()", () => {
  it.each([
    ["openai:gpt-4.1-mini", "openai", "gpt-4.1-mini"],
    ["gemini:gemini-2.5-flash", "gemini", "gemini-2.5-flash"],
    ["sarvam:sarvam-105b", "sarvam", "sarvam-105b"],
  ])("parses %s → provider=%s model=%s", (input, provider, model) => {
    const parsed = parseModelId(input);
    expect(parsed.provider).toBe(provider);
    expect(parsed.modelName).toBe(model);
    expect(parsed.original).toBe(input);
  });

  it("is case-insensitive on the prefix and keeps the model name verbatim", () => {
    expect(parseModelId("OpenAI:GPT-4o")).toMatchObject({
      provider: "openai",
      modelName: "GPT-4o",
    });
  });

  it("trims whitespace", () => {
    expect(parseModelId("  gemini:gemini-2.5-flash  ")).toMatchObject({
      provider: "gemini",
      modelName: "gemini-2.5-flash",
    });
  });

  // ADR-0011: removed providers, and the old bare OpenRouter form, are
  // rejected instead of being silently routed somewhere.
  it.each([
    "groq:llama-3.3-70b-versatile",
    "cerebras:gpt-oss-120b",
    "openrouter:anthropic/claude-4",
    "anthropic/claude-haiku-4-5",
    "gpt-4o-mini",
    ":gpt-4o-mini",
  ])("rejects %s", (input) => {
    expect(() => parseModelId(input)).toThrow(ServiceUnavailableException);
  });
});

describe("AiSdkService", () => {
  let service: AiSdkService;
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };

  beforeEach(async () => {
    env.clear();
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) => env.get(key));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiSdkService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = moduleRef.get(AiSdkService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe("isConfigured() / isProviderConfigured()", () => {
    it("returns false when no provider keys set", () => {
      expect(service.isConfigured()).toBe(false);
      expect(service.isProviderConfigured("openai")).toBe(false);
      expect(service.isProviderConfigured("gemini")).toBe(false);
      expect(service.isProviderConfigured("sarvam")).toBe(false);
    });

    it("returns true once any single provider is configured", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      expect(service.isConfigured()).toBe(true);
      expect(service.isProviderConfigured("openai")).toBe(true);
      expect(service.isProviderConfigured("gemini")).toBe(false);
    });
  });

  describe("getDefaultModel()", () => {
    it("returns the env-configured default when set", () => {
      env.set("DEFAULT_AI_MODEL", "openai:gpt-4.1");
      expect(service.getDefaultModel()).toBe("openai:gpt-4.1");
    });

    it("falls back to openai:gpt-4.1-mini (a supported, prefixed id) when env unset", () => {
      expect(service.getDefaultModel()).toBe("openai:gpt-4.1-mini");
      expect(() => parseModelId(service.getDefaultModel())).not.toThrow();
    });
  });

  describe("getModel() lazy provider init", () => {
    it("throws when the resolved provider has no key", () => {
      for (const id of [
        "openai:gpt-4.1-mini",
        "gemini:gemini-2.5-flash",
        "sarvam:sarvam-105b",
      ]) {
        expect(() => service.getModel(id)).toThrow(ServiceUnavailableException);
      }
    });

    it("returns a LanguageModel for each configured provider", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      env.set("GOOGLE_API_KEY", "g-test");
      env.set("SARVAM_API_KEY", "sv-test");
      expect(service.getModel("openai:gpt-4.1-mini")).toBeDefined();
      expect(service.getModel("gemini:gemini-2.5-flash")).toBeDefined();
      expect(service.getModel("sarvam:sarvam-105b")).toBeDefined();
    });

    it("caches the provider — second call does not re-init", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      const a = service.getModel("openai:gpt-4.1-mini");
      const b = service.getModel("openai:gpt-4.1-mini");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it("rejects a removed provider even when a key is configured", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      expect(() => service.getModel("groq:llama-3.3-70b-versatile")).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("getEmbeddingModel()", () => {
    it("throws for sarvam (no embeddings)", () => {
      env.set("SARVAM_API_KEY", "sv-test");
      expect(() => service.getEmbeddingModel("sarvam:any")).toThrow(
        ServiceUnavailableException,
      );
    });

    it("returns an embedding model for openai", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      const m = service.getEmbeddingModel("openai:text-embedding-3-small");
      expect(m).toBeDefined();
    });
  });

  describe("onModuleInit model-id check", () => {
    it.each([
      ["DEFAULT_AI_MODEL", "openai/gpt-4.1-mini"],
      ["SUMMARIZATION_MODEL", "groq:llama-3.3-70b-versatile"],
    ])("fails the boot when %s is %s", (name, value) => {
      env.set(name, value);
      expect(() => service.onModuleInit()).toThrow(name);
    });

    it("boots with supported model ids in env", () => {
      env.set("DEFAULT_AI_MODEL", "openai:gpt-4.1");
      env.set("SUMMARIZATION_MODEL", "gemini:gemini-2.5-flash");
      env.set("AI_KEEPALIVE_HEARTBEAT_MS", "0");
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe("onModuleInit + onModuleDestroy", () => {
    it("logs a warning when no providers are configured (no warmup)", () => {
      service.onModuleInit();
      // No throw; no heartbeat timer scheduled.
    });

    it("clears the heartbeat interval on destroy", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      env.set("AI_KEEPALIVE_HEARTBEAT_MS", "0"); // disable heartbeat
      service.onModuleInit();
      // No interval to clear; should be a no-op.
      service.onModuleDestroy();
    });

    it("accepts numeric AI_KEEPALIVE_HEARTBEAT_MS", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      env.set("AI_KEEPALIVE_HEARTBEAT_MS", "10000");
      service.onModuleInit();
      service.onModuleDestroy();
    });

    it("falls back to default for malformed AI_KEEPALIVE_HEARTBEAT_MS", () => {
      env.set("OPENAI_API_KEY", "sk-test");
      env.set("AI_KEEPALIVE_HEARTBEAT_MS", "not-a-number");
      service.onModuleInit();
      service.onModuleDestroy();
    });
  });
});
