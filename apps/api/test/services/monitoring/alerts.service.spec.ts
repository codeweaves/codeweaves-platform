import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import type { InternalEventLogger } from "../../../src/common/events/internal.logger";
import {
  AlertsService,
  istDayStart,
} from "../../../src/modules/monitoring/alerts.service";
import type { HeartbeatService } from "../../../src/modules/monitoring/heartbeat.service";
import type { SlackNotifierService } from "../../../src/modules/monitoring/slack-notifier.service";
import type { PrismaService } from "../../../src/services/prisma.service";

// 2026-10-10 15:00 IST.
const NOW = new Date("2026-10-10T09:30:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

type ProviderGroup = {
  provider: string;
  success: boolean;
  _count: { _all: number };
};
type CostRow = { organizationId: string; todayInr: number; avgInr: number };

describe("AlertsService", () => {
  const prisma = {
    eventLog: { groupBy: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    usageRecord: { groupBy: jest.fn() },
    chatSession: { count: jest.fn() },
    organization: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const slack = { isConfigured: jest.fn(), send: jest.fn() };
  const heartbeat = { ping: jest.fn() };
  const internalLog = { logCompleted: jest.fn() };

  // State the default mocks read from. Each test sets only what it needs.
  let providerGroups: ProviderGroup[];
  let costRows: CostRow[];
  let unpriced: Array<{
    provider: string;
    model: string;
    _count: { _all: number };
  }>;
  /** eventName → has a row inside the job's window. Default: every job is fresh. */
  let recentRun: Record<string, boolean>;
  /** eventName → has any row at all. Default: every job has run before. */
  let everRan: Record<string, boolean>;
  let alertSentRows: Array<{ metadata: unknown }>;

  const make = (env: Record<string, string> = {}) =>
    new AlertsService(
      prisma as unknown as PrismaService,
      slack as unknown as SlackNotifierService,
      heartbeat as unknown as HeartbeatService,
      internalLog as unknown as InternalEventLogger,
      {
        get: (key: string) =>
          ({
            APP_ENV: "staging",
            DASHBOARD_URL: "https://app.klivo.test/",
            ...env,
          })[key],
      } as unknown as ConfigService,
    );

  const sentTexts = (): string[] =>
    slack.send.mock.calls.map((c) => (c[0] as { text: string }).text);

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ["setImmediate", "nextTick", "queueMicrotask", "setTimeout"],
    });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    providerGroups = [];
    costRows = [];
    unpriced = [];
    recentRun = {};
    everRan = {};
    alertSentRows = [];

    slack.isConfigured.mockReturnValue(true);
    slack.send.mockResolvedValue(true);
    prisma.eventLog.groupBy.mockImplementation(async () => providerGroups);
    prisma.$queryRaw.mockImplementation(async () => costRows);
    prisma.usageRecord.groupBy.mockImplementation(async () => unpriced);
    prisma.eventLog.findFirst.mockImplementation(
      async ({
        where,
      }: {
        where: { eventName: string; createdAt?: unknown };
      }) => {
        const hit = where.createdAt
          ? (recentRun[where.eventName] ?? true)
          : (everRan[where.eventName] ?? true);
        return hit ? { id: "row" } : null;
      },
    );
    prisma.eventLog.findMany.mockImplementation(async () => alertSentRows);
    prisma.chatSession.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);
  });

  describe("run()", () => {
    it("is a no-op when Slack is not configured", async () => {
      slack.isConfigured.mockReturnValue(false);

      const summary = await make().run();

      expect(summary).toEqual(expect.objectContaining({ disabled: true }));
      expect(prisma.eventLog.groupBy).not.toHaveBeenCalled();
      expect(heartbeat.ping).not.toHaveBeenCalled();
    });

    it("runs all four checks and pings the ALERTS heartbeat when all pass", async () => {
      const summary = await make().run();

      expect(summary).toEqual({
        checked: 4,
        alertsSent: 0,
        suppressed: 0,
        deferred: 0,
        failedChecks: [],
      });
      expect(heartbeat.ping).toHaveBeenCalledWith("ALERTS");
    });

    it("keeps going when one check throws, but withholds the heartbeat", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("db timeout"));
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];

      const summary = await make().run();

      expect(summary.failedChecks).toEqual(["org-daily-cost"]);
      expect(summary.checked).toBe(3);
      expect(summary.alertsSent).toBe(1);
      expect(heartbeat.ping).not.toHaveBeenCalled();
    });

    it("records each delivered alert as an ALERT_SENT event with its key", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];

      await make().run();

      expect(internalLog.logCompleted).toHaveBeenCalledWith(
        "ALERT_SENT",
        expect.objectContaining({
          metadata: expect.objectContaining({ alertKey: "unpriced-usage" }),
        }),
      );
    });

    it("suppresses a key that fired inside the cooldown (from event_logs)", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];
      alertSentRows = [{ metadata: { alertKey: "unpriced-usage" } }];

      const summary = await make({ ALERT_COOLDOWN_HOURS: "2" }).run();

      expect(summary).toMatchObject({ alertsSent: 0, suppressed: 1 });
      expect(slack.send).not.toHaveBeenCalled();
      expect(prisma.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventName: "ALERT_SENT",
            createdAt: { gte: new Date(NOW.getTime() - 2 * HOUR) },
          },
        }),
      );
    });

    it("suppresses a repeat on the same instance even if the event_logs write is missing", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];
      const svc = make();

      await svc.run();
      const second = await svc.run();

      expect(second).toMatchObject({ alertsSent: 0, suppressed: 1 });
      expect(slack.send).toHaveBeenCalledTimes(1);
    });

    it("does not record an alert Slack refused, so the next run retries it", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];
      slack.send.mockResolvedValue(false);
      const svc = make();

      const first = await svc.run();
      expect(first).toMatchObject({ alertsSent: 0, deferred: 1 });
      expect(internalLog.logCompleted).not.toHaveBeenCalled();

      slack.send.mockResolvedValue(true);
      const second = await svc.run();
      expect(second).toMatchObject({ alertsSent: 1, suppressed: 0 });
    });

    it("sends at most 10 alerts per run and defers the rest", async () => {
      providerGroups = Array.from({ length: 12 }, (_, i) => ({
        provider: `P${i}`,
        success: false,
        _count: { _all: 30 },
      }));

      const summary = await make().run();

      expect(summary).toMatchObject({ alertsSent: 10, deferred: 2 });
    });

    it("names the environment and links the status page", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];

      await make().run();

      const [text] = sentTexts();
      expect(text).toContain("[staging]");
      expect(text).toContain(
        "<https://app.klivo.test/dashboard/admin/status|Open the status page>",
      );
    });

    it("falls back to NODE_ENV when APP_ENV is unset", async () => {
      unpriced = [{ provider: "OPENAI", model: "gpt-x", _count: { _all: 2 } }];

      await make({ APP_ENV: "", NODE_ENV: "production" }).run();

      expect(sentTexts()[0]).toContain("[production]");
    });

    it("skips a run that overlaps one still in progress", async () => {
      let release!: () => void;
      prisma.eventLog.groupBy.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
      );
      const svc = make();

      const first = svc.run();
      const second = await svc.run();
      release();
      await first;

      expect(second).toMatchObject({ skipped: true });
    });
  });

  describe("provider error rate", () => {
    const group = (provider: string, ok: number, failed: number) => [
      { provider, success: true, _count: { _all: ok } },
      { provider, success: false, _count: { _all: failed } },
    ];

    it("queries OUTBOUND rows of the last 15 minutes", async () => {
      await make().checkProviderErrorRate(NOW);

      expect(prisma.eventLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            direction: "OUTBOUND",
            provider: { not: null },
            createdAt: { gte: new Date(NOW.getTime() - 15 * MIN) },
          },
        }),
      );
    });

    it("fires above 10% with enough calls", async () => {
      providerGroups = group("OPENAI", 20, 5); // 20%

      const alerts = await make().checkProviderErrorRate(NOW);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.key).toBe("provider-error-rate:OPENAI");
      expect(alerts[0]?.body).toContain("5 of 25");
    });

    it("stays quiet at or below the threshold", async () => {
      providerGroups = group("OPENAI", 27, 3); // exactly 10%

      expect(await make().checkProviderErrorRate(NOW)).toEqual([]);
    });

    it("stays quiet below the minimum call count, even at 100% failures", async () => {
      providerGroups = group("SARVAM", 0, 19);

      expect(await make().checkProviderErrorRate(NOW)).toEqual([]);
    });

    it("honours ALERT_PROVIDER_ERROR_RATE and ALERT_PROVIDER_MIN_CALLS", async () => {
      providerGroups = group("GEMINI", 8, 2); // 20% of 10

      const alerts = await make({
        ALERT_PROVIDER_ERROR_RATE: "0.15",
        ALERT_PROVIDER_MIN_CALLS: "10",
      }).checkProviderErrorRate(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["provider-error-rate:GEMINI"]);
    });
  });

  describe("daily cost per organization", () => {
    beforeEach(() => {
      prisma.organization.findMany.mockResolvedValue([
        { id: "org-1", name: "Acme <!channel>" },
      ]);
    });

    it("passes the IST day start and the 7-day window to the query", async () => {
      await make().checkOrgDailyCost(NOW);

      const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      const todayStart = new Date("2026-10-09T18:30:00.000Z");
      expect(sql.values).toEqual(
        expect.arrayContaining([
          todayStart,
          new Date(todayStart.getTime() - 7 * 24 * HOUR),
        ]),
      );
      expect(sql.sql).toContain("usage_records");
      expect(sql.sql).toContain("fx_rates");
    });

    it("fires above the fixed INR threshold, with the org name", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 1200, avgInr: 900 }];

      const alerts = await make().checkOrgDailyCost(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["org-daily-cost:org-1"]);
      expect(alerts[0]?.title).toContain("Acme <!channel>");
      expect(alerts[0]?.organizationId).toBe("org-1");
    });

    it("stays quiet below the threshold with no jump", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 900, avgInr: 800 }];

      expect(await make().checkOrgDailyCost(NOW)).toEqual([]);
    });

    it("honours ALERT_DAILY_ORG_COST_INR", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 600, avgInr: 500 }];

      const alerts = await make({
        ALERT_DAILY_ORG_COST_INR: "500",
      }).checkOrgDailyCost(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["org-daily-cost:org-1"]);
    });

    it("fires on a jump above 3x the 7-day average", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 400, avgInr: 100 }];

      const alerts = await make().checkOrgDailyCost(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["org-cost-spike:org-1"]);
    });

    it("ignores a jump of 3x or less", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 300, avgInr: 100 }];

      expect(await make().checkOrgDailyCost(NOW)).toEqual([]);
    });

    it("ignores a jump when today is ₹50 or less", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 45, avgInr: 5 }];

      expect(await make().checkOrgDailyCost(NOW)).toEqual([]);
    });

    it("ignores a jump when there is no 7-day history", async () => {
      costRows = [{ organizationId: "org-1", todayInr: 400, avgInr: 0 }];

      expect(await make().checkOrgDailyCost(NOW)).toEqual([]);
    });
  });

  describe("unpriced usage", () => {
    it("raises one alert listing the top provider/models, largest first", async () => {
      unpriced = [
        { provider: "SARVAM", model: "bulbul:v3", _count: { _all: 2 } },
        { provider: "OPENAI", model: "gpt-5", _count: { _all: 9 } },
      ];

      const alerts = await make().checkUnpricedUsage(NOW);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.key).toBe("unpriced-usage");
      expect(alerts[0]?.title).toBe("11 usage rows have no price");
      expect(alerts[0]?.fields?.[0]).toEqual({
        label: "OPENAI / gpt-5",
        value: "9 rows",
      });
      expect(prisma.usageRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            cost: null,
            occurredAt: { gte: new Date(NOW.getTime() - 24 * HOUR) },
          },
        }),
      );
    });

    it("stays quiet when every row is priced", async () => {
      expect(await make().checkUnpricedUsage(NOW)).toEqual([]);
    });
  });

  describe("stale cron jobs", () => {
    it("stays quiet when every job ran inside its window", async () => {
      expect(await make().checkStaleCrons(NOW)).toEqual([]);
    });

    it("fires for a job with no run inside its window", async () => {
      recentRun = { HANDOVER_SWEEP_COMPLETED: false };

      const alerts = await make().checkStaleCrons(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["stale-cron:handover-sweep"]);
      expect(prisma.eventLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventName: "HANDOVER_SWEEP_COMPLETED",
            createdAt: { gte: new Date(NOW.getTime() - 20 * MIN) },
          },
        }),
      );
    });

    it("uses a 26 h window for the classifier and FX jobs", async () => {
      recentRun = {
        CLASSIFIER_RUN_COMPLETED: false,
        FX_RATE_RUN_COMPLETED: false,
      };

      const alerts = await make().checkStaleCrons(NOW);

      expect(alerts.map((a) => a.key).sort()).toEqual([
        "stale-cron:classifier",
        "stale-cron:fx",
      ]);
      expect(prisma.eventLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventName: "FX_RATE_RUN_COMPLETED",
            createdAt: { gte: new Date(NOW.getTime() - 26 * HOUR) },
          },
        }),
      );
    });

    it("skips a job that has never run on this environment", async () => {
      recentRun = { FX_RATE_RUN_COMPLETED: false };
      everRan = { FX_RATE_RUN_COMPLETED: false };

      expect(await make().checkStaleCrons(NOW)).toEqual([]);
    });

    it("skips data extraction when no conversation is overdue", async () => {
      recentRun = { DATA_EXTRACTION_RUN_COMPLETED: false };
      prisma.chatSession.count.mockResolvedValue(0);

      expect(await make().checkStaleCrons(NOW)).toEqual([]);
    });

    it("fires for data extraction when conversations are overdue", async () => {
      recentRun = { DATA_EXTRACTION_RUN_COMPLETED: false };
      prisma.chatSession.count.mockResolvedValue(4);

      const alerts = await make().checkStaleCrons(NOW);

      expect(alerts.map((a) => a.key)).toEqual(["stale-cron:data-extraction"]);
      expect(alerts[0]?.body).toContain("4 conversation(s)");
      expect(prisma.chatSession.count).toHaveBeenCalledWith({
        where: {
          extractionDueAt: { lte: new Date(NOW.getTime() - 10 * MIN) },
        },
      });
    });
  });

  describe("istDayStart()", () => {
    it("returns the previous UTC evening for an IST afternoon", () => {
      expect(istDayStart(new Date("2026-10-10T09:30:00Z")).toISOString()).toBe(
        "2026-10-09T18:30:00.000Z",
      );
    });

    it("rolls over at IST midnight, not UTC midnight", () => {
      // 2026-10-10 20:00 UTC = 2026-10-11 01:30 IST.
      expect(istDayStart(new Date("2026-10-10T20:00:00Z")).toISOString()).toBe(
        "2026-10-10T18:30:00.000Z",
      );
    });
  });
});
