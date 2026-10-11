import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import type { Request, Response } from "express";
import { PublicChatController } from "../../../src/controllers/public/public-chat.controller";
import { ChatService } from "../../../src/services/chat.service";
import { MessageRateLimitService } from "../../../src/services/message-rate-limit.service";
import { DirectChatService } from "../../../src/modules/ai/direct-chat.service";
import { HandoverService } from "../../../src/services/handover.service";
import { PrismaService } from "../../../src/services/prisma.service";
import { WidgetEventLogger } from "../../../src/common/events/widget.logger";
import { CryptoService } from "../../../src/common/crypto/crypto.service";
import { ConsentRequiredException } from "../../../src/services/consent.service";

describe("PublicChatController", () => {
  let controller: PublicChatController;

  const mockChatService = {
    sendMessage: jest.fn(),
    resolveAgent: jest.fn(),
    resolveOrCreateSession: jest.fn(),
    saveUserMessage: jest.fn(),
    saveAssistantMessage: jest.fn(),
    updateSessionTimestamp: jest.fn(),
    deleteMessage: jest.fn(),
  };

  const mockMessageRateLimitService = {
    checkMessageRateLimit: jest.fn(),
    getDeviceIdentifier: jest.fn(),
    getClientIp: jest.fn(),
  };

  const mockDirectChatService = { send: jest.fn(), stream: jest.fn() };

  const mockHandoverService = {
    detectKeyword: jest.fn().mockReturnValue(false),
    stallInstruction: jest.fn().mockReturnValue(""),
    offerInstruction: jest.fn().mockReturnValue(""),
    buildConnectTool: jest.fn().mockReturnValue({}),
    raiseRequested: jest.fn().mockResolvedValue(undefined),
    publishBotTurn: jest.fn().mockResolvedValue(undefined),
    onVisitorMessageWhilePaused: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrisma = {
    agent: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  };

  // Mirrors real behaviour: loopback → undefined, real IP → vh_ hash.
  // Implementation applied in beforeEach (jest resetMocks: true).
  const mockCrypto = { hashVisitorIp: jest.fn(), hashVisitorDevice: jest.fn() };
  const hashVisitorIpImpl = (ip?: string | null) =>
    !ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.")
      ? undefined
      : `vh_${ip}`;

  function createMockRequest(): Request {
    return {
      headers: { "x-device-id": "test-device" },
      ip: "127.0.0.1",
    } as unknown as Request;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicChatController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        {
          provide: MessageRateLimitService,
          useValue: mockMessageRateLimitService,
        },
        { provide: DirectChatService, useValue: mockDirectChatService },
        { provide: HandoverService, useValue: mockHandoverService },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: WidgetEventLogger,
          useValue: {
            logMessageReceived: jest.fn(),
            logReplySent: jest.fn(),
            logRateLimited: jest.fn(),
            logException: jest.fn(),
            logSessionStarted: jest.fn(),
          },
        },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    controller = module.get<PublicChatController>(PublicChatController);
    jest.clearAllMocks();
    mockCrypto.hashVisitorIp.mockImplementation(hashVisitorIpImpl);
    mockCrypto.hashVisitorDevice.mockImplementation((id?: string | null) =>
      id ? `vd_${id}` : undefined,
    );
    mockMessageRateLimitService.getDeviceIdentifier.mockReturnValue(
      "test-device",
    );
    mockMessageRateLimitService.getClientIp.mockReturnValue("203.0.113.1");
    mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
      allowed: true,
    });
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("requestHuman (button)", () => {
    it("escalates to REQUESTED deterministically — no LLM/stream call", async () => {
      mockChatService.resolveAgent.mockResolvedValue({
        id: "agent-1",
        aiConfig: {},
      });
      mockChatService.resolveOrCreateSession.mockResolvedValue({
        id: "sess-db",
        sessionId: "sess-pub",
        handoverState: "NONE",
      });
      mockPrisma.agent.findUniqueOrThrow.mockResolvedValue({
        id: "agent-1",
        humanTakeoverEnabled: true,
        organizationId: "org-1",
      });

      const result = await controller.requestHuman(
        { agentId: "agent-1", sessionId: "sess-pub", source: "WIDGET" },
        createMockRequest(),
      );

      expect(mockHandoverService.raiseRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionDbId: "sess-db",
          publicSessionId: "sess-pub",
          organizationId: "org-1",
        }),
        "USER_REQUESTED",
      );
      // A button press must never cost a model turn.
      expect(mockDirectChatService.stream).not.toHaveBeenCalled();
      expect(result).toEqual({
        sessionId: "sess-pub",
        handoverState: "REQUESTED",
      });
    });

    it("does not escalate when takeover is disabled on the agent", async () => {
      mockChatService.resolveAgent.mockResolvedValue({
        id: "agent-1",
        aiConfig: {},
      });
      mockChatService.resolveOrCreateSession.mockResolvedValue({
        id: "sess-db",
        sessionId: "sess-pub",
        handoverState: "NONE",
      });
      mockPrisma.agent.findUniqueOrThrow.mockResolvedValue({
        id: "agent-1",
        humanTakeoverEnabled: false,
        organizationId: "org-1",
      });

      const result = await controller.requestHuman(
        { agentId: "agent-1" },
        createMockRequest(),
      );

      expect(mockHandoverService.raiseRequested).not.toHaveBeenCalled();
      expect(result.handoverState).toBe("NONE");
    });
  });

  describe("sendMessage", () => {
    const dto = {
      chatInput: "Hello!",
      agentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };

    const mockResponse = {
      sessionId: "session-uuid",
      messageId: "msg-uuid",
      reply: "AI response",
      assistantMessageId: "assistant-msg-uuid",
      metadata: {
        backendReceivedAt: "2026-03-01T10:00:00.000Z",
        backendRespondedAt: "2026-03-01T10:00:01.300Z",
        responseLatencyMs: 1300,
      },
    };

    it("should call chatService.sendMessage and return result", async () => {
      mockChatService.sendMessage.mockResolvedValue(mockResponse);
      const req = createMockRequest();

      const result = await controller.sendMessage(dto, req);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dto, {
        visitorId: "vd_test-device",
        ipHash: undefined,
      }); // device ID is the identity; loopback IP suppressed (S1)
      expect(result).toEqual(mockResponse);
    });

    it("should pass through the dto with sessionId", async () => {
      const dtoWithSession = { ...dto, sessionId: "existing-session" };
      mockChatService.sendMessage.mockResolvedValue(mockResponse);
      const req = createMockRequest();

      await controller.sendMessage(dtoWithSession, req);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dtoWithSession, {
        visitorId: "vd_test-device",
        ipHash: undefined,
      });
    });

    it("should return friendly error JSON (not 429) when rate limited", async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      const req = createMockRequest();

      const result = await controller.sendMessage(dto, req);

      expect(result).toEqual({
        error: true,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it("should extract deviceId and agentId for rate limit check", async () => {
      mockChatService.sendMessage.mockResolvedValue(mockResponse);
      const req = createMockRequest();

      await controller.sendMessage(dto, req);

      expect(
        mockMessageRateLimitService.getDeviceIdentifier,
      ).toHaveBeenCalledWith(req);
      expect(mockMessageRateLimitService.getClientIp).toHaveBeenCalledWith(req);
      expect(
        mockMessageRateLimitService.checkMessageRateLimit,
      ).toHaveBeenCalledWith("test-device", dto.agentId, "203.0.113.1");
    });
  });

  describe("stream", () => {
    const dto = {
      chatInput: "Hello!",
      agentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };

    const mockAgent = {
      id: "agent-db-id",
      aiConfig: {},
      organizationId: "org-1",
    };
    const mockFullAgent = {
      ...mockAgent,
      humanTakeoverEnabled: false,
      humanConnectedLabel: null,
      fallbackPhrases: [],
    };
    const mockSession = {
      id: "session-db-id",
      sessionId: "session-uuid",
      agentId: "agent-1",
      source: "WIDGET",
      handoverState: "NONE",
    };

    type StreamChunk =
      | { type: "text-delta"; content: string }
      | { type: "finish"; result: Record<string, unknown> }
      | { type: "trace"; step: string; durationMs: number }
      | { type: "error"; error: string };

    const finishChunk: StreamChunk = {
      type: "finish",
      result: {
        text: "Hello world!",
        traceId: "trace-1",
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
        cost: 0.0001,
        model: "openai:gpt-4.1-mini",
        finishReason: "stop",
        latencyMs: 400,
        ttftMs: 120,
        historyCount: 0,
        estimatedInputTokens: 12,
        historyTruncated: false,
      },
    };

    function createMockResponse() {
      const written: string[] = [];
      const headers: Record<string, string> = {};
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mock = {
        setHeader: jest.fn((key: string, value: string) => {
          headers[key] = value;
        }),
        write: jest.fn((data: string) => {
          written.push(data);
        }),
        end: jest.fn(),
        on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
      } as unknown as jest.Mocked<Response>;
      return Object.assign(mock, {
        _written: written,
        _headers: headers,
        _listeners: listeners,
      });
    }

    async function* createMockGenerator(chunks: StreamChunk[]) {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    function primeAgentAndSession() {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockPrisma.agent.findUniqueOrThrow.mockResolvedValue(mockFullAgent);
      mockChatService.saveUserMessage.mockResolvedValue({ id: "user-msg-id" });
      mockChatService.saveAssistantMessage.mockResolvedValue({
        id: "assistant-msg-id",
      });
      mockChatService.updateSessionTimestamp.mockResolvedValue({});
      mockChatService.deleteMessage.mockResolvedValue({});
    }

    function setupStreamingMocks(options?: { chunks?: StreamChunk[] }) {
      primeAgentAndSession();
      const chunks = options?.chunks ?? [
        { type: "text-delta", content: "Hello" },
        { type: "text-delta", content: " world" },
        { type: "text-delta", content: "!" },
        finishChunk,
      ];
      mockDirectChatService.stream.mockReturnValue(createMockGenerator(chunks));
    }

    function parseEvents(res: { _written: string[] }, type: string) {
      return res._written
        .filter((d) => d.includes(`"type":"${type}"`))
        .map((e) => JSON.parse(e.replace("data: ", "").trim()));
    }

    it("should set SSE response headers", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
      expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
      expect(res.setHeader).toHaveBeenCalledWith("X-Accel-Buffering", "no");
    });

    it("should stream real token chunks as SSE events", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "chunk")).toEqual([
        { type: "chunk", content: "Hello" },
        { type: "chunk", content: " world" },
        { type: "chunk", content: "!" },
      ]);
    });

    it("should send done event with assistant messageId and metadata (P1)", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const doneEvents = parseEvents(res, "done");
      expect(doneEvents).toHaveLength(1);
      const parsed = doneEvents[0]!;
      expect(parsed.sessionId).toBe("session-uuid");
      // P1: messageId is the ASSISTANT message ID, pre-generated inline so the
      // `done` event does not wait for the DB write.
      expect(parsed.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(parsed.metadata.streamingMode).toBe("direct");
      expect(parsed.metadata.totalChunks).toBe(3);
      expect(parsed.metadata.timeToFirstToken).toEqual(expect.any(Number));
      expect(parsed.metadata.streamDurationMs).toEqual(expect.any(Number));
      expect(parsed.handoverState).toBe("NONE");
    });

    it("strips internal cost, model and trace fields from the widget's done event", async () => {
      setupStreamingMocks();
      const res = createMockResponse();

      await controller.stream(dto, createMockRequest(), res);

      const metadata = parseEvents(res, "done")[0]!.metadata;
      for (const field of [
        "traceId",
        "cost",
        "model",
        "inputTokens",
        "outputTokens",
        "totalTokens",
      ]) {
        expect(metadata).not.toHaveProperty(field);
      }
      // ...but they are kept server-side on the stored message.
      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        mockSession,
        "Hello world!",
        expect.objectContaining({
          traceId: "trace-1",
          model: "openai:gpt-4.1-mini",
          inputTokens: 12,
        }),
        expect.any(String),
      );
    });

    it("should send done event even when the stream yields no text (P2)", async () => {
      setupStreamingMocks({ chunks: [finishChunk] });
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const doneEvents = parseEvents(res, "done");
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0]!.metadata.totalChunks).toBe(0);
      expect(doneEvents[0]!.metadata.timeToFirstToken).toBeNull();
      // The empty assistant message is still saved, with a pre-generated id.
      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        mockSession,
        "",
        expect.objectContaining({ totalChunks: 0 }),
        expect.any(String),
      );
    });

    it("should format SSE events with data: prefix and double newline", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      for (const event of res._written) {
        expect(event).toMatch(/^data: .+\n\n$/);
      }
    });

    it("should call res.end() after streaming completes", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it("should resolve agent, session and the full agent record before streaming", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.resolveAgent).toHaveBeenCalledWith(dto.agentId);
      expect(mockChatService.resolveOrCreateSession).toHaveBeenCalledWith(
        mockAgent.id,
        undefined,
        "WIDGET",
        { visitorId: "vd_test-device", ipHash: undefined },
      ); // loopback IP suppressed (S1)
      expect(mockPrisma.agent.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockAgent.id },
      });
    });

    it("serves every agent through DirectChatService, including one with no aiConfig", async () => {
      setupStreamingMocks();
      mockChatService.resolveAgent.mockResolvedValue({
        ...mockAgent,
        aiConfig: null,
      });
      const res = createMockResponse();

      await controller.stream(dto, createMockRequest(), res);

      expect(mockDirectChatService.stream).toHaveBeenCalledTimes(1);
      expect(parseEvents(res, "chunk")).toHaveLength(3);
    });

    it("should pass the turn and an abortSignal to DirectChatService.stream", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockDirectChatService.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: mockFullAgent,
          chatSessionId: mockSession.id,
          externalSessionId: mockSession.sessionId,
          newUserMessage: dto.chatInput,
          feature: "chat-stream",
          abortSignal: expect.any(AbortSignal),
        }),
      );
    });

    it("should use ChatService for DB operations (P3) — fire-and-forget user save + assistant save", async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      // User message persisted fire-and-forget with a pre-generated UUID (3rd
      // arg). 4th arg = organizationId, passed because PII redaction is always
      // on → storage tokenises VAULT-tier PII.
      expect(mockChatService.saveUserMessage).toHaveBeenCalledWith(
        mockSession,
        dto.chatInput,
        expect.any(String),
        "org-1",
      );

      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        mockSession,
        "Hello world!",
        expect.objectContaining({ totalChunks: 3, streamingMode: "direct" }),
        expect.any(String),
      );

      expect(mockChatService.updateSessionTimestamp).toHaveBeenCalledWith(
        mockSession.id,
      );
    });

    it("should not fail when stream errors after agent resolve fails (D1 graceful)", async () => {
      mockChatService.resolveAgent.mockRejectedValue(new Error("DB down"));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.deleteMessage).not.toHaveBeenCalled();
      expect(parseEvents(res, "error")).toHaveLength(1);
    });

    it("should send error event when resolveAgent throws NotFoundException", async () => {
      mockChatService.resolveAgent.mockRejectedValue(
        new NotFoundException("Agent not found or inactive"),
      );
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "error")).toEqual([
        { type: "error", message: "Agent not found or inactive" },
      ]);
      expect(res.end).toHaveBeenCalled();
    });

    it("should send generic error event for unexpected errors", async () => {
      mockChatService.resolveAgent.mockRejectedValue(
        new Error("Something broke"),
      );
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "error")).toEqual([
        { type: "error", message: "An unexpected error occurred" },
      ]);
    });

    it("should map service timeout error to friendly message (IG2)", async () => {
      primeAgentAndSession();
      async function* timeoutGenerator(): AsyncGenerator<StreamChunk> {
        yield { type: "trace", step: "context", durationMs: 5 };
        throw new Error("Streaming request timed out");
      }
      mockDirectChatService.stream.mockReturnValue(timeoutGenerator());

      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = parseEvents(res, "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.message).toBe(
        "Stream timeout - response took too long",
      );
    });

    it("maps a provider error chunk to a generic unavailable message, never the raw provider error", async () => {
      setupStreamingMocks({
        chunks: [{ type: "error", error: "openai 429: quota for org-xyz" }],
      });
      const res = createMockResponse();

      await controller.stream(dto, createMockRequest(), res);

      expect(parseEvents(res, "error")).toEqual([
        {
          type: "error",
          message:
            "The assistant is temporarily unavailable. Please try again.",
        },
      ]);
      expect(JSON.stringify(res._written)).not.toContain("quota");
    });

    it("sends a consent refusal as a coded SSE error with the live notice, not logged as an exception", async () => {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockPrisma.agent.findUniqueOrThrow.mockResolvedValue(mockFullAgent);
      const notice = {
        mode: "consent" as const,
        noticeText: "We use your chat.",
        linkText: "Privacy Policy",
        privacyPolicyUrl: "https://acme.test/privacy",
        buttonLabel: "Start chat",
        withdrawLabel: "Withdraw consent",
      };
      mockChatService.resolveOrCreateSession.mockRejectedValue(
        new ConsentRequiredException(notice, "a".repeat(64)),
      );
      const widgetLog = controller["widgetLog"] as unknown as {
        logException: jest.Mock;
      };

      const res = createMockResponse();
      await controller.stream(dto, createMockRequest(), res);

      const errorEvents = parseEvents(res, "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        code: "CONSENT_REQUIRED",
        notice,
        noticeHash: "a".repeat(64),
      });
      // Expected behaviour, already an event of its own: not an exception.
      expect(widgetLog.logException).not.toHaveBeenCalled();
    });

    it("should still call res.end() even when error occurs", async () => {
      mockChatService.resolveAgent.mockRejectedValue(new Error("fail"));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalled();
    });

    it("should stop streaming on client disconnect", async () => {
      primeAgentAndSession();

      let yieldCount = 0;
      const mockGenerator = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          yieldCount++;
          if (yieldCount === 1)
            return {
              value: { type: "text-delta", content: "Hello" },
              done: false,
            };
          if (yieldCount === 2)
            return {
              value: { type: "text-delta", content: " again" },
              done: false,
            };
          return { value: undefined, done: true };
        },
        async return() {
          return { value: undefined, done: true };
        },
      };
      mockDirectChatService.stream.mockReturnValue(mockGenerator);

      const req = createMockRequest();
      const res = createMockResponse();

      const originalWrite = res.write as jest.Mock;
      originalWrite.mockImplementation((data: string) => {
        res._written.push(data);
        if (data.includes('"type":"chunk"')) {
          const closeListeners = res._listeners["close"] || [];
          closeListeners.forEach((cb) => cb());
        }
      });

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "chunk")).toHaveLength(1);
      expect(parseEvents(res, "done")).toHaveLength(0);
    });

    it("should send timeout error event after 30s", async () => {
      jest.useFakeTimers();

      mockChatService.resolveAgent.mockReturnValue(new Promise(() => {}));
      const req = createMockRequest();
      const res = createMockResponse();

      void controller.stream(dto, req, res);

      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(30_000);

      expect(parseEvents(res, "error")).toEqual([
        { type: "error", message: "Stream timeout - response took too long" },
      ]);
      expect(res.end).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("should send SSE error event when rate limited (not HTTP 429)", async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "error")).toEqual([
        {
          type: "error",
          message: "You're sending messages too quickly. Please wait a moment.",
        },
      ]);
      expect(res.end).toHaveBeenCalled();
      expect(mockChatService.resolveAgent).not.toHaveBeenCalled();
    });

    it("should handle a stream that throws mid-reply", async () => {
      primeAgentAndSession();
      async function* errorGenerator(): AsyncGenerator<StreamChunk> {
        yield { type: "text-delta", content: "Hello" };
        throw new Error("Connection reset");
      }
      mockDirectChatService.stream.mockReturnValue(errorGenerator());

      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(parseEvents(res, "chunk")).toHaveLength(1);
      expect(parseEvents(res, "error")).toEqual([
        { type: "error", message: "An unexpected error occurred" },
      ]);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
