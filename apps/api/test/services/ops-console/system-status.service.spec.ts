import type { ConfigService } from "@nestjs/config";
import {
  CRON_JOBS,
  SystemStatusService,
  buildJobStatus,
  type CronJobDefinition,
} from "../../../src/modules/ops-console/system-status.service";
import type { PrismaService } from "../../../src/services/prisma.service";
import type { RedisService } from "../../../src/common/redis/redis.service";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** Route each tagged-template query to a fixture by a phrase in its SQL. */
function routeQueries(fixtures: Record<string, unknown[]>) {
  return (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    for (const [needle, rows] of Object.entries(fixtures)) {
      if (sql.includes(needle)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  };
}

describe("SystemStatusService", () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };
  const config = { get: jest.fn() };
  let service: SystemStatusService;

  beforeEach(() => {
    service = new SystemStatusService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
    );
    redis.ping.mockResolvedValue("PONG");
    config.get.mockReturnValue("redis://localhost:6379");
  });

  it("builds one snapshot from parallel SQL aggregates", async () => {
    prisma.$queryRaw.mockImplementation(
      routeQueries({
        "JOIN LATERAL": [
          {
            eventName: "HANDOVER_SWEEP_COMPLETED",
            createdAt: minutesAgo(3),
            latencyMs: null,
            errorMessage: null,
          },
          {
            eventName: "CLASSIFIER_RUN_COMPLETED",
            createdAt: minutesAgo(60 * 30),
            latencyMs: 900,
            errorMessage: null,
          },
          {
            eventName: "CLASSIFIER_RUN_FAILED",
            createdAt: minutesAgo(60),
            latencyMs: null,
            errorMessage: "OpenAI 429",
          },
          {
            eventName: "FX_RATE_RUN_COMPLETED",
            createdAt: minutesAgo(60 * 50),
            latencyMs: null,
            errorMessage: null,
          },
          {
            eventName: "DATA_EXTRACTION_RUN_COMPLETED",
            createdAt: minutesAgo(1),
            latencyMs: 0,
            errorMessage: null,
          },
        ],
        'GROUP BY "eventName"': [
          { eventName: "HANDOVER_SWEEP_COMPLETED", count: 288 },
          { eventName: "CLASSIFIER_RUN_FAILED", count: 1 },
        ],
        "FROM chat_sessions": [{ waiting: 0, oldestDueAt: null }],
        percentile_cont: [
          {
            provider: "OPENAI",
            calls: 200,
            failed: 30,
            p50: 812.4,
            p95: 2400.6,
            lastFailureAt: minutesAgo(2),
          },
          {
            provider: "SARVAM",
            calls: 50,
            failed: 0,
            p50: 300,
            p95: 450,
            lastFailureAt: null,
          },
        ],
        "count(*) FILTER (WHERE cost IS NULL)": [{ total: 1000, unpriced: 12 }],
        "GROUP BY provider, model": [
          {
            provider: "SARVAM",
            model: "saaras:v3",
            count: 12,
            lastSeenAt: minutesAgo(5),
          },
        ],
        "SELECT 1": [{ one: 1 }],
      }),
    );

    const status = await service.snapshot(NOW);
    const job = (key: string) => status.jobs.find((j) => j.key === key)!;

    expect(status.jobs.map((j) => j.key)).toEqual(CRON_JOBS.map((j) => j.key));
    expect(job("handoverSweep")).toEqual(
      expect.objectContaining({ state: "ok", runsLast24h: 288 }),
    );
    expect(job("classifier")).toEqual(
      expect.objectContaining({
        state: "failed",
        lastError: "OpenAI 429",
        failuresLast24h: 1,
        runsLast24h: 1,
      }),
    );
    // Daily job last seen 50 h ago: more than twice its schedule.
    expect(job("fxRate").state).toBe("overdue");
    expect(job("retention").state).toBe("never");
    // Ran 1 minute ago (an idle pass still logs a row), nothing waiting.
    expect(job("dataExtraction")).toEqual(
      expect.objectContaining({
        state: "ok",
        backlog: { waiting: 0, oldestDueAt: null },
      }),
    );

    expect(status.providers.rows[0]).toEqual({
      provider: "OPENAI",
      calls: 200,
      failed: 30,
      errorRate: 0.15,
      p50LatencyMs: 812,
      p95LatencyMs: 2401,
      lastFailureAt: minutesAgo(2).toISOString(),
      alert: true,
    });
    expect(status.providers.rows[1]!.alert).toBe(false);

    expect(status.unpricedUsage).toEqual({
      windowHours: 24,
      totalRecords: 1000,
      unpricedRecords: 12,
      top: [
        {
          provider: "SARVAM",
          model: "saaras:v3",
          count: 12,
          lastSeenAt: minutesAgo(5).toISOString(),
        },
      ],
    });
    expect(status.readiness.status).toBe("ok");
  });

  it("bounds every log query by date and keeps aggregation in SQL", async () => {
    prisma.$queryRaw.mockImplementation(routeQueries({}));

    await service.snapshot(NOW);

    const logQueries = prisma.$queryRaw.mock.calls
      .map(([strings]) => (strings as TemplateStringsArray).join("?"))
      .filter((sql) => /event_logs|usage_records/.test(sql));
    expect(logQueries).toHaveLength(5);
    for (const sql of logQueries) {
      expect(sql).toMatch(/"(createdAt|occurredAt)" >= \?/);
    }
  });

  it("reports a database failure through readiness instead of throwing it away", async () => {
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      strings.join("").includes("SELECT 1")
        ? Promise.reject(new Error("down"))
        : Promise.resolve([]),
    );

    const status = await service.snapshot(NOW);

    expect(status.readiness.status).toBe("fail");
    expect(status.unpricedUsage.unpricedRecords).toBe(0);
  });
});

describe("buildJobStatus", () => {
  const daily: CronJobDefinition = {
    key: "x",
    label: "X",
    endpoint: "/internal/x",
    completedEvent: "X_COMPLETED",
    failedEvent: "X_FAILED",
    expectedEveryMinutes: 24 * 60,
  };
  const row = (createdAt: Date, errorMessage: string | null = null) => ({
    eventName: "X",
    createdAt,
    latencyMs: 10,
    errorMessage,
  });

  it("is ok after a recent success that followed a failure", () => {
    const s = buildJobStatus(
      daily,
      row(minutesAgo(10)),
      row(minutesAgo(60), "e"),
      1,
      1,
      undefined,
      NOW,
    );
    expect(s.state).toBe("ok");
    expect(s.lastError).toBeNull();
    expect(s.lastRunAt).toBe(minutesAgo(10).toISOString());
  });

  it("is failed when the newest run failed, with its error", () => {
    const s = buildJobStatus(
      daily,
      undefined,
      row(minutesAgo(5), "boom"),
      0,
      1,
      undefined,
      NOW,
    );
    expect(s.state).toBe("failed");
    expect(s.lastError).toBe("boom");
  });

  it("turns overdue after twice the schedule", () => {
    expect(
      buildJobStatus(
        daily,
        row(minutesAgo(47 * 60)),
        undefined,
        0,
        0,
        undefined,
        NOW,
      ).state,
    ).toBe("ok");
    expect(
      buildJobStatus(
        daily,
        row(minutesAgo(49 * 60)),
        undefined,
        0,
        0,
        undefined,
        NOW,
      ).state,
    ).toBe("overdue");
  });

  it("data extraction is overdue 2 minutes after its last (even idle) run", () => {
    const extraction = CRON_JOBS.find((j) => j.key === "dataExtraction")!;
    const at = (m: number) =>
      buildJobStatus(
        extraction,
        row(minutesAgo(m)),
        undefined,
        1,
        0,
        { waiting: 0, oldestDueAt: null },
        NOW,
      ).state;
    expect(at(1)).toBe("ok");
    expect(at(3)).toBe("overdue");
  });

  it("is never when no run was recorded", () => {
    expect(
      buildJobStatus(daily, undefined, undefined, 0, 0, undefined, NOW).state,
    ).toBe("never");
  });

  it("flags data extraction as overdue when conversations are stuck waiting", () => {
    const extraction = CRON_JOBS.find((j) => j.key === "dataExtraction")!;
    const s = buildJobStatus(
      extraction,
      row(minutesAgo(1)),
      undefined,
      10,
      0,
      { waiting: 4, oldestDueAt: minutesAgo(30) },
      NOW,
    );
    expect(s.state).toBe("overdue");
    expect(s.backlog).toEqual({
      waiting: 4,
      oldestDueAt: minutesAgo(30).toISOString(),
    });
  });
});
