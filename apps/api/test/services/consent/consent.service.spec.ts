import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../../src/services/prisma.service";
import { TracerService } from "../../../src/common/tracer/tracer.service";
import { WidgetEventLogger } from "../../../src/common/events/widget.logger";
import {
  CONSENT_NOTICE_CHANGED_CODE,
  CONSENT_REQUIRED_CODE,
  ConsentRequiredException,
  ConsentService,
} from "../../../src/services/consent.service";
import {
  computeNoticeHash,
  readConsentConfig,
} from "../../../src/utils/consent-notice";

const AGENT = "agent-1";
const ORG = "org-1";
const VISITOR = "vd_abc";

const CONSENT_THEME = {
  consent: {
    enabled: true,
    mode: "consent",
    noticeText: "We use your chat to answer you.",
    linkText: "Privacy Policy",
    privacyPolicyUrl: "https://acme.test/privacy",
    buttonLabel: "Start chat",
  },
};
const CURRENT_HASH = computeNoticeHash(readConsentConfig(CONSENT_THEME));

describe("ConsentService", () => {
  let service: ConsentService;

  const mockPrisma = {
    agentTheme: { findUnique: jest.fn() },
    visitorConsent: { findFirst: jest.fn(), create: jest.fn() },
    chatSession: { updateMany: jest.fn() },
  };
  const mockTracer = { logAuditEvent: jest.fn() };
  const mockWidgetLog = {
    logConsentDecision: jest.fn(),
    logConsentRequired: jest.fn(),
  };

  function themeIs(config: unknown) {
    mockPrisma.agentTheme.findUnique.mockResolvedValue(
      config === null ? null : { config, agent: { organizationId: ORG } },
    );
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TracerService, useValue: mockTracer },
        { provide: WidgetEventLogger, useValue: mockWidgetLog },
      ],
    }).compile();
    service = moduleRef.get(ConsentService);
    jest.clearAllMocks();
    mockTracer.logAuditEvent.mockResolvedValue(undefined);
  });

  describe("assertConsented", () => {
    it("lets WHATSAPP through without reading the theme (its consent is a later phase)", async () => {
      await expect(
        service.assertConsented(AGENT, "WHATSAPP", "+911234567890"),
      ).resolves.toBeNull();
      expect(mockPrisma.agentTheme.findUnique).not.toHaveBeenCalled();
    });

    it("gates DEMO like WIDGET: source is a caller-sent label and unlocks nothing", async () => {
      themeIs(CONSENT_THEME);
      mockPrisma.visitorConsent.findFirst.mockResolvedValue(null);
      await expect(
        service.assertConsented(AGENT, "DEMO", VISITOR),
      ).rejects.toBeInstanceOf(ConsentRequiredException);
    });

    it("lets everyone through when the agent has no theme or the notice is off", async () => {
      mockPrisma.visitorConsent.findFirst.mockResolvedValue(null);
      themeIs(null);
      await expect(
        service.assertConsented(AGENT, "WIDGET", VISITOR),
      ).resolves.toBeNull();
      themeIs({ consent: { ...CONSENT_THEME.consent, enabled: false } });
      await expect(
        service.assertConsented(AGENT, "WIDGET", VISITOR),
      ).resolves.toBeNull();
    });

    it("lets everyone through in notice mode (nothing to agree to)", async () => {
      mockPrisma.visitorConsent.findFirst.mockResolvedValue(null);
      themeIs({ consent: { ...CONSENT_THEME.consent, mode: "notice" } });
      await expect(
        service.assertConsented(AGENT, "WIDGET", VISITOR),
      ).resolves.toBeNull();
    });

    it("returns the consent id when the latest decision is a GRANT for the current notice", async () => {
      themeIs(CONSENT_THEME);
      mockPrisma.visitorConsent.findFirst.mockResolvedValue({
        id: "c-1",
        action: "GRANTED",
        noticeHash: CURRENT_HASH,
      });

      await expect(
        service.assertConsented(AGENT, "WIDGET", VISITOR),
      ).resolves.toBe("c-1");
      expect(mockPrisma.visitorConsent.findFirst).toHaveBeenCalledWith({
        where: { agentId: AGENT, visitorId: VISITOR },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, noticeHash: true },
      });
    });

    it.each([
      ["no decision", null, "no_decision"],
      [
        "a withdrawal",
        { id: "c-2", action: "WITHDRAWN", noticeHash: CURRENT_HASH },
        "withdrawn",
      ],
      [
        "a grant for an older notice",
        { id: "c-3", action: "GRANTED", noticeHash: "f".repeat(64) },
        "notice_changed",
      ],
    ])(
      "refuses on %s, logs why with the org, and returns the live notice",
      async (_label, latest, reason) => {
        themeIs(CONSENT_THEME);
        mockPrisma.visitorConsent.findFirst.mockResolvedValue(latest);

        const error = await service
          .assertConsented(AGENT, "WIDGET", VISITOR)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConsentRequiredException);
        expect((error as ConsentRequiredException).getStatus()).toBe(403);
        expect((error as ConsentRequiredException).getResponse()).toMatchObject(
          {
            code: CONSENT_REQUIRED_CODE,
            noticeHash: CURRENT_HASH,
            notice: {
              mode: "consent",
              noticeText: CONSENT_THEME.consent.noticeText,
            },
          },
        );
        // organizationId lets visitor erasure find these rows with no session.
        expect(mockWidgetLog.logConsentRequired).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: AGENT,
            organizationId: ORG,
            visitorId: VISITOR,
            metadata: { source: "WIDGET", reason },
          }),
        );
      },
    );

    it("refuses a request without a visitor id and never queries for a decision", async () => {
      themeIs(CONSENT_THEME);
      await expect(
        service.assertConsented(AGENT, "WIDGET", undefined),
      ).rejects.toBeInstanceOf(ConsentRequiredException);
      expect(mockPrisma.visitorConsent.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("record", () => {
    const base = {
      agentId: AGENT,
      organizationId: ORG,
      source: "WIDGET" as const,
      visitor: { visitorId: VISITOR, ipHash: "vh_ip" },
      method: "WIDGET_BUTTON",
    };

    it("records nothing in notice mode or with the notice off", async () => {
      themeIs({ consent: { ...CONSENT_THEME.consent, mode: "notice" } });
      await expect(
        service.record({
          ...base,
          action: "GRANTED",
          noticeHash: CURRENT_HASH,
        }),
      ).resolves.toEqual({ recorded: false });
      expect(mockPrisma.visitorConsent.create).not.toHaveBeenCalled();
    });

    it("stores a GRANT with a snapshot taken from the server copy of the notice", async () => {
      themeIs(CONSENT_THEME);
      mockPrisma.visitorConsent.create.mockResolvedValue({ id: "c-1" });

      const result = await service.record({
        ...base,
        action: "GRANTED",
        noticeHash: CURRENT_HASH,
      });

      expect(result).toEqual({
        recorded: true,
        consentId: "c-1",
        action: "GRANTED",
        noticeHash: CURRENT_HASH,
      });
      expect(mockPrisma.visitorConsent.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          agentId: AGENT,
          visitorId: VISITOR,
          source: "WIDGET",
          action: "GRANTED",
          method: "WIDGET_BUTTON",
          noticeText: CONSENT_THEME.consent.noticeText,
          linkText: "Privacy Policy",
          privacyPolicyUrl: CONSENT_THEME.consent.privacyPolicyUrl,
          buttonLabel: "Start chat",
          noticeHash: CURRENT_HASH,
          ipHash: "vh_ip",
        },
        select: { id: true },
      });
      // A grant never touches sessions.
      expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
    });

    it("refuses a GRANT against a changed notice and returns the current one", async () => {
      themeIs(CONSENT_THEME);

      const error = await service
        .record({ ...base, action: "GRANTED", noticeHash: "f".repeat(64) })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CONSENT_NOTICE_CHANGED_CODE,
        noticeHash: CURRENT_HASH,
        notice: {
          noticeText: CONSENT_THEME.consent.noticeText,
          privacyPolicyUrl: CONSENT_THEME.consent.privacyPolicyUrl,
        },
      });
      expect(mockPrisma.visitorConsent.create).not.toHaveBeenCalled();
    });

    it("accepts a WITHDRAW even against a stale notice and expires only open bot sessions", async () => {
      themeIs(CONSENT_THEME);
      mockPrisma.visitorConsent.create.mockResolvedValue({ id: "c-9" });
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.record({
        ...base,
        action: "WITHDRAWN",
        method: "WIDGET_WITHDRAW_LINK",
        noticeHash: "f".repeat(64),
      });

      expect(result).toMatchObject({ recorded: true, action: "WITHDRAWN" });
      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: {
          agentId: AGENT,
          visitorId: VISITOR,
          status: "ACTIVE",
          handoverState: "NONE",
        },
        data: { status: "EXPIRED" },
      });
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        "c-9",
        "VISITOR_CONSENT_WITHDRAWN",
        expect.objectContaining({ expiredSessions: 1 }),
        { organizationId: ORG, agentId: AGENT },
      );
    });

    it("audits the decision without the visitor id, and writes an event log", async () => {
      themeIs(CONSENT_THEME);
      mockPrisma.visitorConsent.create.mockResolvedValue({ id: "c-1" });

      await service.record({
        ...base,
        action: "GRANTED",
        noticeHash: CURRENT_HASH,
      });

      const [contextId, event, data, scope] =
        mockTracer.logAuditEvent.mock.calls[0]!;
      expect(contextId).toBe("c-1");
      expect(event).toBe("VISITOR_CONSENT_GRANTED");
      expect(JSON.stringify(data)).not.toContain(VISITOR);
      expect(scope).toEqual({ organizationId: ORG, agentId: AGENT });
      expect(mockWidgetLog.logConsentDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: AGENT,
          organizationId: ORG,
          visitorId: VISITOR,
          action: "GRANTED",
        }),
      );
    });
  });
});
