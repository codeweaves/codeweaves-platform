import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { ConversationLimitService } from "../../../src/services/conversation-limit.service";
import { PrismaService } from "../../../src/services/prisma.service";
import { EmailService } from "../../../src/services/email.service";
import { EmailTemplateService } from "../../../src/services/email-template.service";
import { OrganizationLoggerService } from "../../../src/common/logger/organization.logger";
import { InternalEventLogger } from "../../../src/common/events/internal.logger";
import { SUPER_ADMIN_ROLE_KEY } from "../../../src/common/rbac";

/**
 * The fakes below behave like the real tables: `createManyAndReturn` with
 * `skipDuplicates` is ON CONFLICT DO NOTHING on the unique key
 * (organizationId, limitSetAt, threshold) and returns only the rows it
 * inserted, and `count` honours `take`. That makes the concurrency and
 * only-once tests meaningful instead of asserting a canned answer.
 */
describe("ConversationLimitService", () => {
  let service: ConversationLimitService;

  const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";
  const AGENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const SET_AT = new Date("2026-11-01T10:00:00.000Z");

  interface FakeOrg {
    id: string;
    name: string;
    deletedAt: Date | null;
    agentIds: string[];
    contractStartDate: Date | null;
    conversationLimit: number | null;
    conversationLimitSetAt: Date | null;
  }
  interface FakeAlert {
    organizationId: string;
    limitSetAt: Date;
    threshold: number;
    conversationLimit: number;
    conversationsUsed: number;
    createdAt: Date;
  }

  let org: FakeOrg | null;
  let alerts: FakeAlert[];
  let used: number;
  let superAdmins: string[];
  /** Addresses the provider refuses (e.g. example.com). */
  let rejected: Set<string>;
  /** The provider refuses every request. */
  let providerDown: boolean;
  let inFlight: number;
  let maxInFlight: number;
  let emailSeq: number;

  const mockPrisma = {
    organization: { findFirst: jest.fn(), update: jest.fn() },
    conversationLimitAlert: {
      findMany: jest.fn(),
      createManyAndReturn: jest.fn(),
      deleteMany: jest.fn(),
    },
    chatSession: { count: jest.fn() },
    user: { findMany: jest.fn(), count: jest.fn() },
  };
  const mockTemplates = { render: jest.fn() };
  const mockEmail = { send: jest.fn() };
  const mockOrgLogger = { logOrganizationContractUpdated: jest.fn() };
  const mockInternalLog = { logCompleted: jest.fn(), logFailed: jest.fn() };
  const config = {
    get: (key: string) =>
      key === "DASHBOARD_URL" ? "https://app.klivo.ai/" : undefined,
  };

  const contractView = (o: FakeOrg) => ({
    id: o.id,
    name: o.name,
    contractStartDate: o.contractStartDate,
    conversationLimit: o.conversationLimit,
    conversationLimitSetAt: o.conversationLimitSetAt,
  });

  const sameKey = (a: FakeAlert, d: Omit<FakeAlert, "createdAt">) =>
    a.organizationId === d.organizationId &&
    a.limitSetAt.getTime() === d.limitSetAt.getTime() &&
    a.threshold === d.threshold;

  function installFakes() {
    mockPrisma.organization.findFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (!org || org.deletedAt) return null;
        if (where.id !== undefined && where.id !== org.id) return null;
        const agentFilter = where.agents as
          { some: { id: string } } | undefined;
        if (agentFilter && !org.agentIds.includes(agentFilter.some.id))
          return null;
        return contractView(org);
      },
    );
    mockPrisma.organization.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string; deletedAt?: null };
        data: Partial<FakeOrg>;
      }) => {
        const matches =
          org !== null &&
          org.id === where.id &&
          (where.deletedAt !== null || org.deletedAt === null);
        if (!matches) {
          // What Prisma throws when an update's where matches no row.
          throw new Prisma.PrismaClientKnownRequestError(
            "No record was found for an update.",
            {
              code: "P2025",
              clientVersion: "7.10.0",
            },
          );
        }
        org = { ...org!, ...data };
        return contractView(org);
      },
    );
    mockPrisma.conversationLimitAlert.findMany.mockImplementation(
      async ({
        where,
      }: {
        where: { organizationId: string; limitSetAt: Date };
      }) =>
        alerts
          .filter(
            (a) =>
              a.organizationId === where.organizationId &&
              a.limitSetAt.getTime() === where.limitSetAt.getTime(),
          )
          .sort((a, b) => a.threshold - b.threshold)
          .map((a) => ({ threshold: a.threshold, createdAt: a.createdAt })),
    );
    mockPrisma.conversationLimitAlert.createManyAndReturn.mockImplementation(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Omit<FakeAlert, "createdAt">[];
        skipDuplicates?: boolean;
      }) => {
        const inserted: { threshold: number }[] = [];
        for (const row of data) {
          if (alerts.some((a) => sameKey(a, row))) {
            if (skipDuplicates) continue;
            throw new Prisma.PrismaClientKnownRequestError(
              "Unique constraint failed",
              {
                code: "P2002",
                clientVersion: "7.10.0",
              },
            );
          }
          alerts.push({ ...row, createdAt: new Date() });
          inserted.push({ threshold: row.threshold });
        }
        return inserted;
      },
    );
    mockPrisma.conversationLimitAlert.deleteMany.mockImplementation(
      async ({
        where,
      }: {
        where: {
          organizationId: string;
          limitSetAt: Date;
          threshold: { in: number[] };
        };
      }) => {
        const before = alerts.length;
        alerts = alerts.filter(
          (a) =>
            !(
              a.organizationId === where.organizationId &&
              a.limitSetAt.getTime() === where.limitSetAt.getTime() &&
              where.threshold.in.includes(a.threshold)
            ),
        );
        return { count: before - alerts.length };
      },
    );
    mockPrisma.chatSession.count.mockImplementation(
      async ({ take }: { take?: number }) =>
        take === undefined ? used : Math.min(used, take),
    );
    mockPrisma.user.findMany.mockImplementation(
      async ({ take }: { take?: number }) =>
        superAdmins.slice(0, take).map((email) => ({ email })),
    );
    mockPrisma.user.count.mockImplementation(async () => superAdmins.length);
    mockTemplates.render.mockImplementation(
      async (_key: string, vars: Record<string, string>) => ({
        subject: `${vars.orgName} has used ${vars.thresholdPercent}% of its conversations`,
        html: "<p>body</p>",
        text: "body",
      }),
    );
    // Like Resend: one request is accepted or refused as a whole, so a single
    // bad address in `to` fails the whole request. Returns null on refusal,
    // like EmailService.send. It yields to the event loop while "in flight"
    // so overlapping sends would be visible in maxInFlight.
    mockEmail.send.mockImplementation(
      async ({ to }: { to: string | string[] }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        const list = Array.isArray(to) ? to : [to];
        if (providerDown || list.some((address) => rejected.has(address)))
          return null;
        return { id: `email-${++emailSeq}` };
      },
    );
    mockOrgLogger.logOrganizationContractUpdated.mockResolvedValue(undefined);
  }

  const sentThresholds = () =>
    mockTemplates.render.mock.calls.map((c) =>
      Number((c[1] as Record<string, string>).thresholdPercent),
    );
  /** Alerts that counted as sent (at least one recipient accepted). */
  const sentEvents = () =>
    mockInternalLog.logCompleted.mock.calls.filter(
      (c) => c[0] === "CONVERSATION_LIMIT_ALERT_SENT",
    );
  const sendTargets = () =>
    mockEmail.send.mock.calls.map((c) => (c[0] as { to: unknown }).to);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationLimitService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailTemplateService, useValue: mockTemplates },
        { provide: EmailService, useValue: mockEmail },
        { provide: OrganizationLoggerService, useValue: mockOrgLogger },
        { provide: InternalEventLogger, useValue: mockInternalLog },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(ConversationLimitService);

    org = {
      id: ORG_ID,
      name: "Acme Corp",
      deletedAt: null,
      agentIds: [AGENT_ID],
      contractStartDate: null,
      conversationLimit: 100,
      conversationLimitSetAt: SET_AT,
    };
    alerts = [];
    used = 0;
    superAdmins = ["founder@klivo.ai", "ops@klivo.ai"];
    rejected = new Set();
    providerDown = false;
    inFlight = 0;
    maxInFlight = 0;
    emailSeq = 0;
    installFakes();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("checkAfterNewConversation", () => {
    it("stops after the first query when the organization has no limit", async () => {
      org = { ...org!, conversationLimit: null, conversationLimitSetAt: null };

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.organization.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.organization.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agents: { some: { id: AGENT_ID } }, deletedAt: null },
        }),
      );
      expect(mockPrisma.conversationLimitAlert.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.count).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
    });

    it("does nothing for an agent with no live organization", async () => {
      org = { ...org!, deletedAt: new Date() };

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.chatSession.count).not.toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
    });

    it("counts only WIDGET and WHATSAPP sessions since the limit was set, with no cap", async () => {
      used = 10;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.chatSession.count).toHaveBeenCalledWith({
        where: {
          agent: { organizationId: ORG_ID },
          source: { in: ["WIDGET", "WHATSAPP"] },
          createdAt: { gte: SET_AT },
        },
      });
    });

    // Sales may bill from the alert, so a late alert must carry the real
    // count, not the limit.
    it("reports the real count above the limit when the 100% alert goes out late", async () => {
      org = { ...org!, conversationLimit: 17000 };
      used = 16000;
      await service.checkAfterNewConversation(AGENT_ID); // 50 and 90 sent

      // The 100% send fails once; the retry happens 50 conversations later.
      used = 17000;
      providerDown = true;
      await service.checkAfterNewConversation(AGENT_ID);
      providerDown = false;
      used = 17050;
      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockTemplates.render).toHaveBeenLastCalledWith(
        "CONVERSATION_LIMIT_ALERT",
        expect.objectContaining({
          thresholdPercent: "100",
          conversationsUsed: "17,050",
          conversationLimit: "17,000",
          conversationsRemaining: "0",
        }),
      );
      expect(sentEvents().at(-1)?.[1]).toMatchObject({
        metadata: {
          threshold: 100,
          conversationsUsed: 17050,
          conversationLimit: 17000,
        },
      });
      expect(alerts.find((a) => a.threshold === 100)).toMatchObject({
        conversationsUsed: 17050,
      });
    });

    it("reports the real count when usage jumps far past the limit at once", async () => {
      org = { ...org!, conversationLimit: 4 };
      used = 5;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockTemplates.render).toHaveBeenCalledWith(
        "CONVERSATION_LIMIT_ALERT",
        expect.objectContaining({
          thresholdPercent: "100",
          conversationsUsed: "5",
          conversationLimit: "4",
          conversationsRemaining: "0",
        }),
      );
      expect(sentEvents()[0]?.[1]).toMatchObject({
        metadata: { conversationsUsed: 5, conversationLimit: 4 },
      });
    });

    it.each([
      // percent used, rows recorded, email threshold
      [49, [], null],
      [50, [50], 50],
      [89, [50], 50],
      [90, [50, 90], 90],
      [99, [50, 90], 90],
      [100, [50, 90, 100], 100],
      [150, [50, 90, 100], 100],
    ])(
      "at %i%% of the limit records %j and emails the %s%% alert",
      async (percent, recorded, emailed) => {
        used = percent; // limit is 100, so used == percent

        await service.checkAfterNewConversation(AGENT_ID);

        expect(alerts.map((a) => a.threshold).sort((a, b) => a - b)).toEqual(
          recorded,
        );
        if (emailed === null) {
          expect(
            mockPrisma.conversationLimitAlert.createManyAndReturn,
          ).not.toHaveBeenCalled();
          expect(mockEmail.send).not.toHaveBeenCalled();
        } else {
          // One alert: rendered once, one email per super admin.
          expect(sentThresholds()).toEqual([emailed]);
          expect(sentEvents()).toHaveLength(1);
          expect(mockEmail.send).toHaveBeenCalledTimes(2);
        }
      },
    );

    it("uses exact integer maths for a real-size limit", async () => {
      org = { ...org!, conversationLimit: 17000 };
      used = 15299;
      await service.checkAfterNewConversation(AGENT_ID);
      expect(sentThresholds()).toEqual([50]);

      used = 15300; // exactly 90%
      await service.checkAfterNewConversation(AGENT_ID);
      expect(sentThresholds()).toEqual([50, 90]);
    });

    it("records the usage and limit on each alert row", async () => {
      used = 90;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(alerts).toEqual([
        expect.objectContaining({
          organizationId: ORG_ID,
          limitSetAt: SET_AT,
          threshold: 50,
          conversationLimit: 100,
          conversationsUsed: 90,
        }),
        expect.objectContaining({ threshold: 90, conversationsUsed: 90 }),
      ]);
    });

    it("sends each threshold only once per limit as usage grows", async () => {
      for (const n of [50, 51, 60, 89, 90, 95, 100, 120]) {
        used = n;
        await service.checkAfterNewConversation(AGENT_ID);
      }

      expect(sentThresholds()).toEqual([50, 90, 100]);
      expect(sentEvents()).toHaveLength(3);
      expect(mockEmail.send).toHaveBeenCalledTimes(6);
    });

    it("skips the count once all three alerts for this limit are sent", async () => {
      used = 100;
      await service.checkAfterNewConversation(AGENT_ID);
      mockPrisma.chatSession.count.mockClear();

      used = 101;
      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.chatSession.count).not.toHaveBeenCalled();
      expect(sentEvents()).toHaveLength(1);
    });

    it("ignores alerts that belong to an earlier limit", async () => {
      const oldSetAt = new Date("2026-01-01T00:00:00.000Z");
      for (const threshold of [50, 90, 100]) {
        alerts.push({
          organizationId: ORG_ID,
          limitSetAt: oldSetAt,
          threshold,
          conversationLimit: 100,
          conversationsUsed: 100,
          createdAt: oldSetAt,
        });
      }
      used = 50;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(sentThresholds()).toEqual([50]);
    });

    it("sends one alert when two conversations cross the threshold at once", async () => {
      used = 50;

      await Promise.all([
        service.checkAfterNewConversation(AGENT_ID),
        service.checkAfterNewConversation(AGENT_ID),
      ]);

      // Both calls tried to insert; the unique key let only one through.
      expect(
        mockPrisma.conversationLimitAlert.createManyAndReturn,
      ).toHaveBeenCalledTimes(2);
      expect(alerts).toHaveLength(1);
      expect(sentEvents()).toHaveLength(1);
      expect(sendTargets()).toEqual(["founder@klivo.ai", "ops@klivo.ai"]);
    });

    it("emails every super admin with the rendered alert", async () => {
      used = 90;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          roleAssignments: {
            some: { roleKey: SUPER_ADMIN_ROLE_KEY, deletedAt: null },
          },
        },
        select: { email: true },
        orderBy: { createdAt: "asc" },
        // One past the cap, so going over it needs no extra query to detect.
        take: 21,
      });
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
      expect(mockTemplates.render).toHaveBeenCalledWith(
        "CONVERSATION_LIMIT_ALERT",
        {
          orgName: "Acme Corp",
          thresholdPercent: "90",
          conversationsUsed: "90",
          conversationLimit: "100",
          conversationsRemaining: "10",
          organizationUrl: `https://app.klivo.ai/dashboard/organizations/${ORG_ID}`,
        },
      );
      // Rendered once, then one email per recipient with only that address.
      expect(mockTemplates.render).toHaveBeenCalledTimes(1);
      expect(mockEmail.send).toHaveBeenCalledTimes(2);
      for (const to of ["founder@klivo.ai", "ops@klivo.ai"]) {
        expect(mockEmail.send).toHaveBeenCalledWith({
          to,
          subject: "Acme Corp has used 90% of its conversations",
          html: "<p>body</p>",
          text: "body",
          tags: { type: "CONVERSATION_LIMIT_ALERT" },
          organizationId: ORG_ID,
        });
      }
      expect(mockInternalLog.logCompleted).toHaveBeenCalledWith(
        "CONVERSATION_LIMIT_ALERT_SENT",
        {
          agentId: AGENT_ID,
          organizationId: ORG_ID,
          metadata: {
            threshold: 90,
            conversationsUsed: 90,
            conversationLimit: 100,
            recipients: 2,
            delivered: 2,
            failed: 0,
          },
        },
      );
    });

    it("sends the per-recipient emails one after another, never in parallel", async () => {
      superAdmins = ["a@klivo.ai", "b@klivo.ai", "c@klivo.ai", "d@klivo.ai"];
      used = 50;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockEmail.send).toHaveBeenCalledTimes(4);
      expect(maxInFlight).toBe(1);
      expect(sendTargets()).toEqual(superAdmins);
    });

    it("still counts the alert as sent when one of three recipients is refused", async () => {
      superAdmins = ["founder@klivo.ai", "nobody@example.com", "ops@klivo.ai"];
      rejected.add("nobody@example.com");
      used = 50;

      await service.checkAfterNewConversation(AGENT_ID);

      // The bad address did not stop the ones after it.
      expect(sendTargets()).toEqual(superAdmins);
      expect(alerts.map((a) => a.threshold)).toEqual([50]);
      expect(
        mockPrisma.conversationLimitAlert.deleteMany,
      ).not.toHaveBeenCalled();
      expect(mockInternalLog.logFailed).not.toHaveBeenCalled();
      expect(sentEvents()).toEqual([
        [
          "CONVERSATION_LIMIT_ALERT_SENT",
          {
            agentId: AGENT_ID,
            organizationId: ORG_ID,
            metadata: {
              threshold: 50,
              conversationsUsed: 50,
              conversationLimit: 100,
              recipients: 3,
              delivered: 2,
              failed: 1,
            },
          },
        ],
      ]);

      // Not retried for the refused recipient.
      used = 51;
      await service.checkAfterNewConversation(AGENT_ID);
      expect(mockEmail.send).toHaveBeenCalledTimes(3);
    });

    it("treats a send that throws as one failed recipient", async () => {
      used = 50;
      mockEmail.send.mockRejectedValueOnce(new Error("socket hang up"));

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockEmail.send).toHaveBeenCalledTimes(2);
      expect(alerts).toHaveLength(1);
      expect(sentEvents()[0]?.[1]).toMatchObject({
        metadata: { recipients: 2, delivered: 1, failed: 1 },
      });
    });

    it("never puts an email address in event metadata", async () => {
      superAdmins = ["founder@klivo.ai", "nobody@example.com"];
      rejected.add("nobody@example.com");
      used = 50;
      await service.checkAfterNewConversation(AGENT_ID); // partial failure, SENT

      providerDown = true;
      used = 90;
      await service.checkAfterNewConversation(AGENT_ID); // total failure, FAILED

      const events = [
        ...mockInternalLog.logCompleted.mock.calls,
        ...mockInternalLog.logFailed.mock.calls,
      ];
      expect(events.map((c) => c[0]).sort()).toEqual([
        "CONVERSATION_LIMIT_ALERT_FAILED",
        "CONVERSATION_LIMIT_ALERT_SENT",
      ]);
      expect(JSON.stringify(events)).not.toMatch(/@/);
    });

    it("formats large numbers with digit grouping", async () => {
      org = { ...org!, conversationLimit: 17000 };
      used = 8500;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockTemplates.render).toHaveBeenCalledWith(
        "CONVERSATION_LIMIT_ALERT",
        expect.objectContaining({
          conversationsUsed: "8,500",
          conversationLimit: "17,000",
          conversationsRemaining: "8,500",
        }),
      );
    });

    it("sends to the first 20 super admins and counts the rest only when over the cap", async () => {
      superAdmins = Array.from({ length: 25 }, (_, i) => `admin${i}@klivo.ai`);
      used = 50;

      await service.checkAfterNewConversation(AGENT_ID);

      expect(mockPrisma.user.count).toHaveBeenCalledTimes(1);
      expect(sendTargets()).toEqual(superAdmins.slice(0, 20));
    });

    describe("when the alert email does not go out", () => {
      const failedEvent = (
        reason: string,
        threshold: number,
        extra: Record<string, unknown> = {},
      ) =>
        expect(mockInternalLog.logFailed).toHaveBeenCalledWith(
          "CONVERSATION_LIMIT_ALERT_FAILED",
          reason,
          {
            agentId: AGENT_ID,
            organizationId: ORG_ID,
            metadata: {
              threshold,
              reason,
              conversationsUsed: used,
              conversationLimit: 100,
              ...extra,
            },
          },
        );

      it("removes its rows when every recipient is refused, and the next conversation retries", async () => {
        used = 50;
        providerDown = true;

        await expect(
          service.checkAfterNewConversation(AGENT_ID),
        ).resolves.toBeUndefined();

        expect(mockEmail.send).toHaveBeenCalledTimes(2);
        expect(alerts).toEqual([]);
        expect(sentEvents()).toEqual([]);
        failedEvent("PROVIDER_FAILED", 50, { recipients: 2 });

        providerDown = false;
        await service.checkAfterNewConversation(AGENT_ID);

        expect(mockEmail.send).toHaveBeenCalledTimes(4);
        expect(alerts.map((a) => a.threshold)).toEqual([50]);
        expect(sentEvents()).toHaveLength(1);
      });

      it("removes its rows when the only recipients are all refused addresses", async () => {
        superAdmins = ["a@example.com", "b@example.com"];
        rejected = new Set(superAdmins);
        used = 50;

        await service.checkAfterNewConversation(AGENT_ID);

        expect(alerts).toEqual([]);
        failedEvent("PROVIDER_FAILED", 50, { recipients: 2 });
      });

      it("removes every row it inserted, not just the emailed one", async () => {
        used = 100; // inserts 50, 90 and 100, emails 100
        providerDown = true;

        await service.checkAfterNewConversation(AGENT_ID);

        expect(alerts).toEqual([]);
        failedEvent("PROVIDER_FAILED", 100, { recipients: 2 });

        providerDown = false;
        await service.checkAfterNewConversation(AGENT_ID);
        expect(alerts.map((a) => a.threshold).sort((a, b) => a - b)).toEqual([
          50, 90, 100,
        ]);
        expect(sentThresholds()).toEqual([100, 100]);
      });

      it("keeps rows it did not insert", async () => {
        used = 50;
        await service.checkAfterNewConversation(AGENT_ID); // 50 sent and kept

        used = 90;
        providerDown = true;
        await service.checkAfterNewConversation(AGENT_ID); // 90 fails

        expect(alerts.map((a) => a.threshold)).toEqual([50]);
      });

      it("removes its rows when the template fails to render, and retries", async () => {
        used = 50;
        mockTemplates.render.mockRejectedValueOnce(
          new NotFoundException("missing"),
        );

        await expect(
          service.checkAfterNewConversation(AGENT_ID),
        ).resolves.toBeUndefined();

        expect(mockEmail.send).not.toHaveBeenCalled();
        expect(alerts).toEqual([]);
        expect(sentEvents()).toEqual([]);
        failedEvent("RENDER_FAILED", 50);

        await service.checkAfterNewConversation(AGENT_ID);
        expect(mockEmail.send).toHaveBeenCalledTimes(2);
        expect(sentEvents()).toHaveLength(1);
        expect(alerts).toHaveLength(1);
      });

      it("removes its rows when there is no super admin, and retries once one exists", async () => {
        superAdmins = [];
        used = 50;

        await expect(
          service.checkAfterNewConversation(AGENT_ID),
        ).resolves.toBeUndefined();

        expect(mockTemplates.render).not.toHaveBeenCalled();
        expect(mockEmail.send).not.toHaveBeenCalled();
        expect(alerts).toEqual([]);
        failedEvent("NO_RECIPIENTS", 50);

        superAdmins = ["founder@klivo.ai"];
        await service.checkAfterNewConversation(AGENT_ID);
        expect(mockEmail.send).toHaveBeenCalledTimes(1);
        expect(alerts).toHaveLength(1);
      });

      it("removes its rows when the recipient query fails", async () => {
        used = 50;
        mockPrisma.user.findMany.mockRejectedValueOnce(new Error("timeout"));

        await expect(
          service.checkAfterNewConversation(AGENT_ID),
        ).resolves.toBeUndefined();

        expect(alerts).toEqual([]);
        failedEvent("ERROR", 50);
      });

      it("does not throw when removing its rows fails, and leaves them in place", async () => {
        used = 50;
        providerDown = true;
        mockPrisma.conversationLimitAlert.deleteMany.mockRejectedValueOnce(
          new Error("db down"),
        );

        await expect(
          service.checkAfterNewConversation(AGENT_ID),
        ).resolves.toBeUndefined();

        expect(alerts).toHaveLength(1);
        expect(mockInternalLog.logFailed).toHaveBeenCalledWith(
          "CONVERSATION_LIMIT_ALERT_RELEASE_FAILED",
          expect.any(Error),
          { organizationId: ORG_ID, metadata: { thresholds: [50] } },
        );
        expect(sentEvents()).toEqual([]);
      });

      it("lets only the winner of a concurrent claim try, and retries after it fails", async () => {
        used = 50;
        providerDown = true;

        await Promise.all([
          service.checkAfterNewConversation(AGENT_ID),
          service.checkAfterNewConversation(AGENT_ID),
        ]);

        // The loser saw no inserted row and did not send: one round only.
        expect(mockEmail.send).toHaveBeenCalledTimes(2);
        expect(alerts).toEqual([]);

        providerDown = false;
        await Promise.all([
          service.checkAfterNewConversation(AGENT_ID),
          service.checkAfterNewConversation(AGENT_ID),
        ]);

        // One successful round for the threshold, never two.
        expect(mockEmail.send).toHaveBeenCalledTimes(4);
        expect(sentEvents()).toHaveLength(1);
        expect(alerts).toHaveLength(1);
      });
    });

    it("never throws when the database fails", async () => {
      mockPrisma.organization.findFirst.mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(
        service.checkAfterNewConversation(AGENT_ID),
      ).resolves.toBeUndefined();

      expect(mockInternalLog.logFailed).toHaveBeenCalledWith(
        "CONVERSATION_LIMIT_CHECK_FAILED",
        expect.any(Error),
        { agentId: AGENT_ID },
      );
    });
  });

  describe("getContract", () => {
    it("throws 404 for a missing or deleted organization", async () => {
      org = { ...org!, deletedAt: new Date() };
      await expect(service.getContract(ORG_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns zero usage and no counts when there is no limit", async () => {
      org = {
        ...org!,
        contractStartDate: new Date("2026-04-01T00:00:00.000Z"),
        conversationLimit: null,
        conversationLimitSetAt: null,
      };

      await expect(service.getContract(ORG_ID)).resolves.toEqual({
        contractStartDate: "2026-04-01",
        conversationLimit: null,
        conversationLimitSetAt: null,
        conversationsUsed: 0,
        conversationsRemaining: null,
        percentUsed: null,
        alerts: [],
      });
      expect(mockPrisma.chatSession.count).not.toHaveBeenCalled();
    });

    it("returns usage, remaining, percent and the alerts for the current limit", async () => {
      org = { ...org!, conversationLimit: 17000 };
      used = 15400;
      const sentAt50 = new Date("2026-11-05T09:00:00.000Z");
      const sentAt90 = new Date("2026-11-12T09:00:00.000Z");
      alerts.push(
        {
          organizationId: ORG_ID,
          limitSetAt: SET_AT,
          threshold: 90,
          conversationLimit: 17000,
          conversationsUsed: 15300,
          createdAt: sentAt90,
        },
        {
          organizationId: ORG_ID,
          limitSetAt: SET_AT,
          threshold: 50,
          conversationLimit: 17000,
          conversationsUsed: 8500,
          createdAt: sentAt50,
        },
        {
          organizationId: ORG_ID,
          limitSetAt: new Date("2026-01-01T00:00:00.000Z"),
          threshold: 100,
          conversationLimit: 10,
          conversationsUsed: 10,
          createdAt: sentAt50,
        },
      );

      await expect(service.getContract(ORG_ID)).resolves.toEqual({
        contractStartDate: null,
        conversationLimit: 17000,
        conversationLimitSetAt: SET_AT.toISOString(),
        conversationsUsed: 15400,
        conversationsRemaining: 1600,
        percentUsed: 90,
        alerts: [
          { threshold: 50, sentAt: sentAt50.toISOString() },
          { threshold: 90, sentAt: sentAt90.toISOString() },
        ],
      });
      // The page shows the true count, so it is not capped at the limit.
      expect(mockPrisma.chatSession.count).toHaveBeenCalledWith({
        where: {
          agent: { organizationId: ORG_ID },
          source: { in: ["WIDGET", "WHATSAPP"] },
          createdAt: { gte: SET_AT },
        },
      });
    });

    it("lets percent pass 100 and keeps remaining at zero", async () => {
      org = { ...org!, conversationLimit: 17000 };
      used = 20000;

      const contract = await service.getContract(ORG_ID);

      expect(contract.percentUsed).toBe(117);
      expect(contract.conversationsRemaining).toBe(0);
      expect(contract.conversationsUsed).toBe(20000);
    });
  });

  describe("updateContract", () => {
    const NOW = new Date("2026-11-14T12:00:00.000Z");

    beforeEach(() => {
      jest.useFakeTimers({
        now: NOW,
        doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
      });
    });

    it("throws 404 when the organization is deleted between the read and the write", async () => {
      const deletedAt = new Date("2026-11-14T11:59:59.000Z");
      // The read sees a live organization; the delete lands right after it.
      mockPrisma.organization.findFirst.mockImplementationOnce(async () => {
        const live = contractView(org!);
        org = { ...org!, deletedAt };
        return live;
      });

      await expect(
        service.updateContract(ORG_ID, { conversationLimit: 17000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ORG_ID, deletedAt: null } }),
      );
      expect(org!.conversationLimit).toBe(100);
      expect(
        mockOrgLogger.logOrganizationContractUpdated,
      ).not.toHaveBeenCalled();
    });

    it('rethrows a write error that is not "record not found"', async () => {
      mockPrisma.organization.update.mockRejectedValueOnce(
        new Error("connection lost"),
      );

      await expect(
        service.updateContract(ORG_ID, { conversationLimit: 17000 }),
      ).rejects.toThrow("connection lost");
    });

    it("throws 404 and writes nothing for a missing organization", async () => {
      org = null;

      await expect(
        service.updateContract(ORG_ID, { conversationLimit: 17000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
      expect(
        mockOrgLogger.logOrganizationContractUpdated,
      ).not.toHaveBeenCalled();
    });

    it("sets the limit, stamps the time and restarts the count", async () => {
      org = { ...org!, conversationLimit: null, conversationLimitSetAt: null };
      used = 0;

      const result = await service.updateContract(ORG_ID, {
        conversationLimit: 17000,
      });

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG_ID, deletedAt: null },
        data: { conversationLimit: 17000, conversationLimitSetAt: NOW },
        select: expect.any(Object),
      });
      expect(result).toMatchObject({
        conversationLimit: 17000,
        conversationLimitSetAt: NOW.toISOString(),
        conversationsUsed: 0,
        conversationsRemaining: 17000,
        percentUsed: 0,
        alerts: [],
      });
    });

    it("re-stamps when the same number is submitted again, so alerts can fire again", async () => {
      used = 50;
      await service.checkAfterNewConversation(AGENT_ID);
      expect(sentThresholds()).toEqual([50]);

      await service.updateContract(ORG_ID, { conversationLimit: 100 });
      expect(org!.conversationLimit).toBe(100);
      expect(org!.conversationLimitSetAt).toEqual(NOW);
      expect(org!.conversationLimitSetAt).not.toEqual(SET_AT);

      // Sessions after the new stamp count from zero; reaching 50 again alerts again.
      await service.checkAfterNewConversation(AGENT_ID);
      expect(sentThresholds()).toEqual([50, 50]);
      expect(alerts.map((a) => a.limitSetAt.toISOString())).toEqual([
        SET_AT.toISOString(),
        NOW.toISOString(),
      ]);
    });

    it("clears the limit and its stamp with null", async () => {
      const result = await service.updateContract(ORG_ID, {
        conversationLimit: null,
      });

      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { conversationLimit: null, conversationLimitSetAt: null },
        }),
      );
      expect(result).toMatchObject({
        conversationLimit: null,
        conversationLimitSetAt: null,
        conversationsUsed: 0,
        percentUsed: null,
      });
    });

    it("changes only the start date when only the start date is sent", async () => {
      const result = await service.updateContract(ORG_ID, {
        contractStartDate: "2026-04-01",
      });

      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { contractStartDate: new Date("2026-04-01T00:00:00.000Z") },
        }),
      );
      expect(result.contractStartDate).toBe("2026-04-01");
      // The count did not restart.
      expect(result.conversationLimitSetAt).toBe(SET_AT.toISOString());
    });

    it("clears the start date with null", async () => {
      org = {
        ...org!,
        contractStartDate: new Date("2026-04-01T00:00:00.000Z"),
      };

      const result = await service.updateContract(ORG_ID, {
        contractStartDate: null,
      });

      expect(result.contractStartDate).toBeNull();
    });

    it("writes an audit log scoped to the organization with before and after", async () => {
      await service.updateContract(ORG_ID, {
        contractStartDate: "2026-04-01",
        conversationLimit: 17000,
      });

      expect(mockOrgLogger.logOrganizationContractUpdated).toHaveBeenCalledWith(
        ORG_ID,
        {
          request: {
            contractStartDate: "2026-04-01",
            conversationLimit: 17000,
          },
          before: {
            contractStartDate: null,
            conversationLimit: 100,
            conversationLimitSetAt: SET_AT.toISOString(),
          },
          after: {
            contractStartDate: "2026-04-01",
            conversationLimit: 17000,
            conversationLimitSetAt: NOW.toISOString(),
          },
        },
      );
    });
  });
});
