import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ChatService } from "../../../src/services/chat.service";
import { PrismaService } from "../../../src/services/prisma.service";
import { TracerService } from "../../../src/common/tracer/tracer.service";
import { DirectChatService } from "../../../src/modules/ai/direct-chat.service";
import { MessageMetricsService } from "../../../src/services/message-metrics.service";
import { HandoverService } from "../../../src/services/handover.service";
import { PiiDetectionService } from "../../../src/modules/pii/pii-detection.service";
import { PiiTokenizerService } from "../../../src/modules/pii/pii-tokenizer.service";
import { WidgetEventLogger } from "../../../src/common/events/widget.logger";
import {
  ConsentService,
  ConsentRequiredException,
} from "../../../src/services/consent.service";

describe("ChatService", () => {
  let service: ChatService;

  const mockPrismaService = {
    agent: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    chatSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockTracerService = {
    logAuditEvent: jest.fn(),
  };

  const mockDirectChatService = {
    send: jest.fn(),
    stream: jest.fn(),
  };

  const mockMessageMetricsService = {
    record: jest.fn(),
    recordFromMetadata: jest.fn(),
  };

  const mockHandoverService = {
    onVisitorMessageWhilePaused: jest.fn().mockResolvedValue(undefined),
    detectKeyword: jest.fn().mockReturnValue(false),
    raiseRequested: jest.fn().mockResolvedValue(undefined),
    publishBotTurn: jest.fn().mockResolvedValue(undefined),
    stallInstruction: jest
      .fn()
      .mockReturnValue("A teammate is joining shortly."),
  };

  const mockWidgetLog = { logSessionStarted: jest.fn() };

  // Storage-side PII redaction is unit-tested in pii-tokenizer.service.spec.ts;
  // here it passes content through so ChatService's own behaviour is isolated.
  const mockPiiTokenizer = {
    redactForStorage: jest.fn(
      async (_org: string, _sid: string, content: string) => content,
    ),
    forSession: jest.fn(),
  };

  const MOCK_AGENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const MOCK_SESSION_ID = "session-uuid-1234";
  const MOCK_SESSION_DB_ID = "db-session-uuid-1234";
  const MOCK_USER_MSG_ID = "user-msg-uuid-1234";
  const MOCK_ASSISTANT_MSG_ID = "assistant-msg-uuid-1234";

  const mockSession = {
    id: MOCK_SESSION_DB_ID,
    agentId: MOCK_AGENT_ID,
    sessionId: MOCK_SESSION_ID,
    source: "DEMO",
    status: "ACTIVE",
    // NONE = not mid-handover, so the lifetime-cap rotation is allowed to run.
    handoverState: "NONE",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: null,
    // Included for `resolveOrCreateSession`'s per-agent lifetime check.
    // 6h is the default; createdAt being fresh keeps these sessions
    // well inside the lifetime cap during tests.
    agent: { sessionLifetimeHours: 6 },
  };

  const MOCK_FULL_AGENT = {
    id: MOCK_AGENT_ID,
    organizationId: "org-1",
    aiConfig: null,
    fallbackPhrases: [],
    systemPrompt: "",
  };

  const MOCK_LLM_RESULT = {
    text: "Hello! How can I help you?",
    traceId: "trace-1",
    usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
    cost: 0.0001,
    model: "openai:gpt-4.1-mini",
    finishReason: "stop",
    latencyMs: 300,
    ttftMs: null,
    historyCount: 0,
    estimatedInputTokens: 10,
    historyTruncated: false,
  };

  const mockConsentService = { assertConsented: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TracerService, useValue: mockTracerService },
        { provide: DirectChatService, useValue: mockDirectChatService },
        { provide: MessageMetricsService, useValue: mockMessageMetricsService },
        { provide: HandoverService, useValue: mockHandoverService },
        { provide: WidgetEventLogger, useValue: mockWidgetLog },
        { provide: ConsentService, useValue: mockConsentService },
        PiiDetectionService,
        { provide: PiiTokenizerService, useValue: mockPiiTokenizer },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();

    // Consent mode off by default: the gate lets every session through.
    mockConsentService.assertConsented.mockResolvedValue(null);

    // resetMocks wipes inline impls; (re)apply the passthrough each test.
    mockPiiTokenizer.redactForStorage.mockImplementation(
      async (_o: string, _s: string, c: string) => c,
    );

    // Default mocks for a successful flow.
    mockPrismaService.agent.findFirst.mockResolvedValue({
      id: MOCK_AGENT_ID,
      aiConfig: null,
      organizationId: "org-1",
    });
    mockPrismaService.agent.findUniqueOrThrow.mockResolvedValue(
      MOCK_FULL_AGENT,
    );
    mockDirectChatService.send.mockResolvedValue(MOCK_LLM_RESULT);
    mockPrismaService.chatSession.create.mockResolvedValue(mockSession);
    // $transaction returns an array of results: [userMessage, assistantMessage, updatedSession]
    mockPrismaService.$transaction.mockResolvedValue([
      { id: MOCK_USER_MSG_ID },
      { id: MOCK_ASSISTANT_MSG_ID },
      mockSession,
    ]);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("resolveOrCreateSession (widget session-started event)", () => {
    it("emits WIDGET_SESSION_STARTED when a new widget session is created", async () => {
      mockPrismaService.chatSession.create.mockResolvedValue({
        id: "db-1",
        sessionId: "pub-1",
        source: "WIDGET",
      });

      await service.resolveOrCreateSession(MOCK_AGENT_ID, undefined, "WIDGET", {
        visitorId: "vd_abc",
      });

      expect(mockWidgetLog.logSessionStarted).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: MOCK_AGENT_ID, sessionId: "pub-1" }),
      );
    });

    it("does NOT emit WIDGET_SESSION_STARTED for a demo session", async () => {
      mockPrismaService.chatSession.create.mockResolvedValue({
        id: "db-2",
        sessionId: "pub-2",
        source: "DEMO",
      });

      await service.resolveOrCreateSession(MOCK_AGENT_ID, undefined, "DEMO");

      expect(mockWidgetLog.logSessionStarted).not.toHaveBeenCalled();
    });
  });

  describe("resolveOrCreateSession (visitor identity + consent gate)", () => {
    it("stores the device-based visitorId, the ipHash and the consent id on a new session", async () => {
      mockConsentService.assertConsented.mockResolvedValue("consent-1");
      mockPrismaService.chatSession.create.mockResolvedValue({
        id: "db-1",
        sessionId: "pub-1",
        source: "WIDGET",
      });

      await service.resolveOrCreateSession(MOCK_AGENT_ID, undefined, "WIDGET", {
        visitorId: "vd_abc",
        ipHash: "vh_ip",
      });

      expect(mockConsentService.assertConsented).toHaveBeenCalledWith(
        MOCK_AGENT_ID,
        "WIDGET",
        "vd_abc",
      );
      expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visitorId: "vd_abc",
          ipHash: "vh_ip",
          consentId: "consent-1",
        }),
      });
    });

    it("creates no session when the consent gate refuses", async () => {
      mockConsentService.assertConsented.mockRejectedValue(
        new ConsentRequiredException(),
      );

      await expect(
        service.resolveOrCreateSession(MOCK_AGENT_ID, undefined, "WIDGET", {
          visitorId: "vd_abc",
        }),
      ).rejects.toBeInstanceOf(ConsentRequiredException);
      expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
      expect(mockWidgetLog.logSessionStarted).not.toHaveBeenCalled();
    });

    it("does not re-run the gate for an existing active session", async () => {
      mockPrismaService.chatSession.findFirst.mockResolvedValue({
        id: "db-1",
        sessionId: "pub-1",
        visitorId: "vd_abc",
        ipHash: "vh_ip",
        handoverState: "NONE",
        createdAt: new Date(),
        agent: { sessionLifetimeHours: 6 },
      });

      await service.resolveOrCreateSession(MOCK_AGENT_ID, "pub-1", "WIDGET", {
        visitorId: "vd_abc",
      });

      expect(mockConsentService.assertConsented).not.toHaveBeenCalled();
    });
  });

  describe("isPiiRedactionEnabled (ADR-0005)", () => {
    it.each([
      ["no config", null],
      ["an empty config", {}],
      [
        "a stored false from before the toggle was removed",
        { piiRedactionEnabled: false },
      ],
      ["an explicit true", { piiRedactionEnabled: true }],
    ])("is always on, with %s", (_label, aiConfig) => {
      expect(ChatService.isPiiRedactionEnabled(aiConfig as never)).toBe(true);
    });
  });

  describe("resolveOrCreateVisitorSession (WhatsApp / server-keyed channels)", () => {
    const PHONE = "15551234567";

    it("returns the active session when within the lifetime cap", async () => {
      const active = {
        id: "sess-1",
        agentId: MOCK_AGENT_ID,
        sessionId: "uuid-1",
        source: "WHATSAPP",
        status: "ACTIVE",
        visitorId: PHONE,
        createdAt: new Date(),
        updatedAt: new Date(),
        agent: { sessionLifetimeHours: 6 },
      };
      mockPrismaService.chatSession.findFirst.mockResolvedValue(active);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        "WHATSAPP",
        PHONE,
      );

      expect(result).toBe(active);
      expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agentId: MOCK_AGENT_ID,
            source: "WHATSAPP",
            visitorId: PHONE,
            status: "ACTIVE",
          },
        }),
      );
      expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
    });

    it("creates a new session (random UUID) when none is active", async () => {
      mockPrismaService.chatSession.findFirst.mockResolvedValue(null);
      const created = { id: "sess-new", sessionId: "uuid-new" };
      mockPrismaService.chatSession.create.mockResolvedValue(created);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        "WHATSAPP",
        PHONE,
      );

      expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          agentId: MOCK_AGENT_ID,
          source: "WHATSAPP",
          visitorId: PHONE,
          sessionId: expect.any(String),
        }),
      });
      expect(result).toBe(created);
    });

    it("rotates (EXPIRES old + creates fresh) when past the lifetime cap", async () => {
      const stale = {
        id: "sess-old",
        agentId: MOCK_AGENT_ID,
        sessionId: "uuid-old",
        source: "WHATSAPP",
        status: "ACTIVE",
        handoverState: "NONE",
        visitorId: PHONE,
        createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h ago, cap is 6h
        updatedAt: new Date(),
        agent: { sessionLifetimeHours: 6 },
      };
      mockPrismaService.chatSession.findFirst.mockResolvedValue(stale);
      const fresh = { id: "sess-fresh", sessionId: "uuid-fresh" };
      mockPrismaService.chatSession.create.mockResolvedValue(fresh);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        "WHATSAPP",
        PHONE,
      );

      expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
        where: { id: "sess-old" },
        data: { status: "EXPIRED" },
      });
      expect(mockPrismaService.chatSession.create).toHaveBeenCalled();
      expect(result).toBe(fresh);
    });
  });

  describe("sendMessage", () => {
    const baseDto = {
      chatInput: "Hello, AI!",
      agentId: MOCK_AGENT_ID,
    };

    describe("successful message send + LLM call + response storage", () => {
      it("should send a message, call DirectChatService, and store the response", async () => {
        const result = await service.sendMessage(baseDto);

        expect(result).toEqual(
          expect.objectContaining({
            sessionId: MOCK_SESSION_ID,
            messageId: MOCK_USER_MSG_ID,
            reply: MOCK_LLM_RESULT.text,
            assistantMessageId: MOCK_ASSISTANT_MSG_ID,
          }),
        );
        expect(result.metadata).toEqual(
          expect.objectContaining({
            streamingMode: "direct",
            backendReceivedAt: expect.any(String),
            backendRespondedAt: expect.any(String),
            responseLatencyMs: expect.any(Number),
            traceId: MOCK_LLM_RESULT.traceId,
            model: MOCK_LLM_RESULT.model,
            inputTokens: 10,
          }),
        );
      });

      it("should call DirectChatService.send with the full agent and the session", async () => {
        await service.sendMessage(baseDto);

        expect(mockDirectChatService.send).toHaveBeenCalledWith(
          expect.objectContaining({
            agent: MOCK_FULL_AGENT,
            chatSessionId: MOCK_SESSION_DB_ID,
            externalSessionId: MOCK_SESSION_ID,
            newUserMessage: "Hello, AI!",
            feature: "chat",
          }),
        );
      });

      it("serves an agent with no aiConfig through DirectChatService (no routing switch)", async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue({
          id: MOCK_AGENT_ID,
          aiConfig: null,
          organizationId: "org-1",
        });

        const result = await service.sendMessage(baseDto);

        expect(mockDirectChatService.send).toHaveBeenCalledTimes(1);
        expect(result.reply).toBe(MOCK_LLM_RESULT.text);
      });

      it("should store user and assistant messages in a transaction", async () => {
        await service.sendMessage(baseDto);

        // $transaction receives an array of 3 Prisma promises
        const transactionArg = mockPrismaService.$transaction.mock.calls[0][0];
        expect(Array.isArray(transactionArg)).toBe(true);
        expect(transactionArg).toHaveLength(3);
      });

      it("should not store messages if the LLM call fails", async () => {
        mockDirectChatService.send.mockRejectedValue(
          new Error("provider down"),
        );

        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          "provider down",
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it("returns paused with no AI call while a human holds the chat", async () => {
        mockPrismaService.chatSession.create.mockResolvedValue({
          ...mockSession,
          handoverState: "ACTIVE_HUMAN",
        });

        const result = await service.sendMessage(baseDto);

        expect(result).toEqual(
          expect.objectContaining({ paused: true, reply: "" }),
        );
        expect(mockDirectChatService.send).not.toHaveBeenCalled();
        expect(
          mockHandoverService.onVisitorMessageWhilePaused,
        ).toHaveBeenCalled();
      });
    });

    describe("new session creation (no sessionId)", () => {
      it("should create a new ChatSession when no sessionId is provided", async () => {
        await service.sendMessage(baseDto);

        expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
          data: {
            agentId: MOCK_AGENT_ID,
            sessionId: expect.any(String),
            source: "DEMO",
            visitorId: null,
            ipHash: null,
            consentId: null,
          },
        });
        expect(mockPrismaService.chatSession.findFirst).not.toHaveBeenCalled();
      });

      it("should return the sessionId from the created session", async () => {
        const result = await service.sendMessage(baseDto);
        expect(result.sessionId).toBe(MOCK_SESSION_ID);
      });
    });

    describe("existing session reuse (sessionId provided)", () => {
      const dtoWithSession = {
        ...baseDto,
        sessionId: MOCK_SESSION_ID,
      };

      it("should look up existing session and reuse it", async () => {
        mockPrismaService.chatSession.findFirst.mockResolvedValue(mockSession);

        const result = await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith({
          where: {
            sessionId: MOCK_SESSION_ID,
            agentId: MOCK_AGENT_ID,
            status: "ACTIVE",
          },
          // The lookup pulls the agent's per-row lifetime so the expiry
          // check uses the configured value, not a hardcoded constant.
          include: { agent: { select: { sessionLifetimeHours: true } } },
        });
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
        expect(result.sessionId).toBe(MOCK_SESSION_ID);
      });

      it("should throw NotFoundException when session not found", async () => {
        mockPrismaService.chatSession.findFirst.mockResolvedValue(null);

        await expect(service.sendMessage(dtoWithSession)).rejects.toThrow(
          NotFoundException,
        );
        await expect(service.sendMessage(dtoWithSession)).rejects.toThrow(
          "Session not found or does not belong to this agent",
        );
      });
    });

    describe("session lifetime rotation (6h from createdAt)", () => {
      const dtoWithSession = {
        ...baseDto,
        sessionId: MOCK_SESSION_ID,
      };

      it("rotates the session when createdAt is older than 6 hours: flips old to EXPIRED and creates a fresh one", async () => {
        // Session born 7h ago — past the SESSION_LIFETIME_MS cap.
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
        });

        const result = await service.sendMessage(dtoWithSession);

        // Old row was marked EXPIRED
        expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
          where: { id: MOCK_SESSION_DB_ID },
          data: { status: "EXPIRED" },
        });
        // A brand-new session row was created — `sessionId` is generated, so
        // we don't assert the exact value, just that create was called.
        expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            agentId: MOCK_AGENT_ID,
            source: "DEMO",
            sessionId: expect.any(String),
          }),
        });
        // The response sessionId is the NEW one (returned by `create`).
        expect(result.sessionId).toBe(MOCK_SESSION_ID); // mocked create returns mockSession
      });

      it("does NOT rotate when createdAt is within 6 hours", async () => {
        const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: fiveHoursAgo,
        });

        await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "EXPIRED" } }),
        );
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
      });

      it("uses createdAt for the lifetime check, NOT lastMessageAt", async () => {
        // createdAt 7h ago, lastMessageAt 1 minute ago — by an idle-based
        // check this would NOT rotate, but our rule is lifetime-from-creation.
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const aMinuteAgo = new Date(Date.now() - 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
          lastMessageAt: aMinuteAgo,
        });

        await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
          where: { id: MOCK_SESSION_DB_ID },
          data: { status: "EXPIRED" },
        });
        expect(mockPrismaService.chatSession.create).toHaveBeenCalled();
      });

      it("respects per-agent sessionLifetimeHours: 7h-old session keeps living when agent allows 24h", async () => {
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
          agent: { sessionLifetimeHours: 24 },
        });

        await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: "EXPIRED" } }),
        );
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
      });
    });

    describe("agent not found / inactive", () => {
      it("should throw NotFoundException when agent does not exist", async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue(null);

        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          NotFoundException,
        );
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          "Agent not found or inactive",
        );
        expect(mockDirectChatService.send).not.toHaveBeenCalled();
      });

      it("should verify agent is ACTIVE and not deleted", async () => {
        await service.sendMessage(baseDto);

        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: { id: MOCK_AGENT_ID, deletedAt: null, status: "ACTIVE" },
          select: {
            id: true,
            aiConfig: true,
            organizationId: true,
          },
        });
      });
    });
  });

  describe("saveUserMessage", () => {
    it("should create a USER role chat message", async () => {
      const mockMsg = { id: "msg-1", role: "USER", content: "Hello" };
      mockPrismaService.chatMessage.create.mockResolvedValue(mockMsg);

      const result = await service.saveUserMessage(
        { id: "session-db-id", agentId: "agent-1", source: "WIDGET" as const },
        "Hello",
      );

      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledWith({
        data: {
          chatSessionId: "session-db-id",
          agentId: "agent-1",
          sessionSource: "WIDGET",
          role: "USER",
          content: "Hello",
        },
      });
      expect(result).toEqual(mockMsg);
    });
  });

  describe("maybeEscalateToHuman", () => {
    const agentEnabled = {
      humanTakeoverEnabled: true,
      organizationId: "org-1",
    };
    const noneSession = {
      id: "db-1",
      sessionId: "pub-1",
      agentId: "agent-1",
      source: "WIDGET" as const,
      handoverState: "NONE",
    };

    it("escalates when takeover is on, session is NONE, and the text asks for a human", async () => {
      mockHandoverService.detectKeyword.mockReturnValueOnce(true);

      const result = await service.maybeEscalateToHuman(
        noneSession,
        agentEnabled,
        "let me talk to a human",
      );

      expect(result).toBe(true);
      expect(mockHandoverService.raiseRequested).toHaveBeenCalledWith(
        {
          sessionDbId: "db-1",
          publicSessionId: "pub-1",
          agentId: "agent-1",
          source: "WIDGET",
          organizationId: "org-1",
        },
        "USER_REQUESTED",
      );
    });

    it("does nothing when the agent has human takeover disabled", async () => {
      mockHandoverService.detectKeyword.mockReturnValueOnce(true);

      const result = await service.maybeEscalateToHuman(
        noneSession,
        { humanTakeoverEnabled: false, organizationId: "org-1" },
        "talk to a human",
      );

      expect(result).toBe(false);
      expect(mockHandoverService.raiseRequested).not.toHaveBeenCalled();
    });

    it("does nothing when the session is already in a handover", async () => {
      mockHandoverService.detectKeyword.mockReturnValueOnce(true);

      const result = await service.maybeEscalateToHuman(
        {
          id: "db-1",
          sessionId: "pub-1",
          agentId: "agent-1",
          source: "WIDGET" as const,
          handoverState: "REQUESTED",
        },
        agentEnabled,
        "talk to a human",
      );

      expect(result).toBe(false);
      expect(mockHandoverService.raiseRequested).not.toHaveBeenCalled();
    });

    it("does nothing when the text is not a human request", async () => {
      mockHandoverService.detectKeyword.mockReturnValueOnce(false);

      const result = await service.maybeEscalateToHuman(
        noneSession,
        agentEnabled,
        "what are your hours?",
      );

      expect(result).toBe(false);
      expect(mockHandoverService.raiseRequested).not.toHaveBeenCalled();
    });
  });

  describe("saveAssistantMessage", () => {
    it("should create an ASSISTANT role chat message with metadata", async () => {
      const metadata = { totalChunks: 5, streamDurationMs: 1000 };
      const mockMsg = {
        id: "msg-2",
        role: "ASSISTANT",
        content: "Hi there",
        metadata,
      };
      mockPrismaService.chatMessage.create.mockResolvedValue(mockMsg);

      const result = await service.saveAssistantMessage(
        { id: "session-db-id", agentId: "agent-1", source: "WIDGET" as const },
        "Hi there",
        metadata,
      );

      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledWith({
        data: {
          chatSessionId: "session-db-id",
          agentId: "agent-1",
          sessionSource: "WIDGET",
          role: "ASSISTANT",
          content: "Hi there",
          metadata,
        },
      });
      expect(result).toEqual(mockMsg);
    });
  });

  describe("updateSessionTimestamp", () => {
    it("should update the session lastMessageAt", async () => {
      mockPrismaService.chatSession.update.mockResolvedValue({});

      await service.updateSessionTimestamp("session-db-id");

      expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
        where: { id: "session-db-id" },
        data: { lastMessageAt: expect.any(Date) },
      });
    });
  });

  describe("deleteMessage", () => {
    it("should delete a chat message by ID", async () => {
      mockPrismaService.chatMessage.delete.mockResolvedValue({});

      await service.deleteMessage("msg-to-delete");

      expect(mockPrismaService.chatMessage.delete).toHaveBeenCalledWith({
        where: { id: "msg-to-delete" },
      });
    });
  });
});
