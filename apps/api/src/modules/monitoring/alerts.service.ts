import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { InternalEventLogger } from "../../common/events/internal.logger";
import { AppLogger } from "../../common/logger/app-logger";
import { PrismaService } from "../../services/prisma.service";
import { HeartbeatService } from "./heartbeat.service";
import {
  escapeSlack,
  SlackNotifierService,
  type SlackField,
} from "./slack-notifier.service";

/** One alert candidate. `key` is the de-duplication key for the cooldown. */
export interface Alert {
  key: string;
  title: string;
  body: string;
  fields?: SlackField[];
  organizationId?: string;
}

export interface AlertRunSummary {
  /** Checks that ran to completion. */
  checked: number;
  alertsSent: number;
  /** Alerts held back because the same key fired inside the cooldown. */
  suppressed: number;
  /** Alerts over the per-run cap, or whose Slack post failed. They retry next run. */
  deferred: number;
  failedChecks: string[];
  /** True when Slack is not configured: the job is a no-op. */
  disabled?: boolean;
  /** True when a previous run was still going on this instance. */
  skipped?: boolean;
}

/** The event_logs row that records a delivered alert (the cooldown store). */
export const ALERT_SENT_EVENT = "ALERT_SENT";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** IST is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = 330 * MINUTE;

const PROVIDER_WINDOW_MS = 15 * MINUTE;
const UNPRICED_WINDOW_MS = DAY;
/** A spike alert needs today's cost above this many times the 7-day average… */
const SPIKE_MULTIPLIER = 3;
/** …and above this floor, so a ₹2 day after a ₹0.50 week stays quiet. */
const SPIKE_MIN_TODAY_INR = 50;
/** Slack allows about one message a second per webhook; keep each run short. */
const MAX_ALERTS_PER_RUN = 10;

/**
 * Cron jobs whose silence we alert on, keyed by the completion event each job
 * writes to event_logs. A job with no completion row at all is skipped: that
 * environment does not run it.
 */
export const STALE_CRON_RULES: ReadonlyArray<{
  job: string;
  label: string;
  eventName: string;
  maxAgeMs: number;
  /**
   * Any DATA_EXTRACTION_RUN_COMPLETED row counts as a run, idle ones too. Older
   * builds wrote no row for an idle pass, so we also require overdue sessions:
   * a quiet hour must never look like a dead job.
   */
  onlyWithOverdueExtractions?: boolean;
}> = [
  {
    job: "classifier",
    label: "Conversation classifier",
    eventName: "CLASSIFIER_RUN_COMPLETED",
    maxAgeMs: 26 * HOUR,
  },
  {
    job: "data-extraction",
    label: "Data extraction",
    eventName: "DATA_EXTRACTION_RUN_COMPLETED",
    maxAgeMs: 10 * MINUTE,
    onlyWithOverdueExtractions: true,
  },
  {
    job: "handover-sweep",
    label: "Handover sweep",
    eventName: "HANDOVER_SWEEP_COMPLETED",
    maxAgeMs: 20 * MINUTE,
  },
  {
    job: "fx",
    label: "USD to INR rate",
    eventName: "FX_RATE_RUN_COMPLETED",
    maxAgeMs: 26 * HOUR,
  },
];

/** Start of the current IST day, as a UTC instant. */
export function istDayStart(now: Date): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (shifted % DAY) - IST_OFFSET_MS);
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function describeWindow(ms: number): string {
  return ms >= HOUR ? `${ms / HOUR} h` : `${ms / MINUTE} min`;
}

/**
 * Our own ops alerts (ADR-0013), run by an external cron every 15 minutes via
 * POST /internal/alerts/run. Each check is one aggregate query; each alert key
 * fires at most once per cooldown. Delivered alerts are recorded as
 * `ALERT_SENT` rows in event_logs, which is also the cooldown store.
 *
 * This job cannot alert when the API itself is down. Better Stack's uptime
 * monitors and the ALERTS heartbeat cover that case.
 */
@Injectable()
export class AlertsService {
  private readonly log = new AppLogger(AlertsService.name);
  private readonly cooldownMs: number;
  private readonly providerErrorRate: number;
  private readonly providerMinCalls: number;
  private readonly dailyOrgCostInr: number;
  private readonly environment: string;
  private readonly statusUrl: string | undefined;
  /**
   * Same-instance backstop for the cooldown: covers EVENT_LOG_ENABLED=false
   * and the moment between a send and its fire-and-forget ALERT_SENT write.
   */
  private readonly sentAt = new Map<string, number>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackNotifierService,
    private readonly heartbeat: HeartbeatService,
    private readonly internalLog: InternalEventLogger,
    config: ConfigService,
  ) {
    const num = (name: string, fallback: number): number => {
      const value = Number(config.get<string>(name));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    this.cooldownMs = num("ALERT_COOLDOWN_HOURS", 6) * HOUR;
    this.providerErrorRate = num("ALERT_PROVIDER_ERROR_RATE", 0.1);
    this.providerMinCalls = num("ALERT_PROVIDER_MIN_CALLS", 20);
    this.dailyOrgCostInr = num("ALERT_DAILY_ORG_COST_INR", 1000);
    this.environment =
      config.get<string>("APP_ENV") ||
      config.get<string>("NODE_ENV") ||
      "unknown";
    const dashboard = config.get<string>("DASHBOARD_URL")?.replace(/\/+$/, "");
    this.statusUrl = dashboard
      ? `${dashboard}/dashboard/admin/status`
      : undefined;
  }

  async run(): Promise<AlertRunSummary> {
    const summary: AlertRunSummary = {
      checked: 0,
      alertsSent: 0,
      suppressed: 0,
      deferred: 0,
      failedChecks: [],
    };
    if (!this.slack.isConfigured()) return { ...summary, disabled: true };
    if (this.running) return { ...summary, skipped: true };
    this.running = true;
    try {
      const now = new Date();
      const checks: Array<[string, () => Promise<Alert[]>]> = [
        ["provider-error-rate", () => this.checkProviderErrorRate(now)],
        ["org-daily-cost", () => this.checkOrgDailyCost(now)],
        ["unpriced-usage", () => this.checkUnpricedUsage(now)],
        ["stale-cron", () => this.checkStaleCrons(now)],
      ];
      // Each check is isolated: one failing query never hides the others.
      const outcomes = await Promise.all(
        checks.map(async ([name, fn]) => {
          try {
            return { name, alerts: await fn() };
          } catch (err) {
            this.log.error("run", `alert check ${name} failed`, err);
            return { name, alerts: null };
          }
        }),
      );

      const candidates: Alert[] = [];
      for (const { name, alerts } of outcomes) {
        if (alerts === null) {
          summary.failedChecks.push(name);
          continue;
        }
        summary.checked += 1;
        candidates.push(...alerts);
      }

      const recent = await this.recentlyAlertedKeys(now);
      for (const alert of candidates) {
        if (recent.has(alert.key)) {
          summary.suppressed += 1;
          continue;
        }
        if (summary.alertsSent >= MAX_ALERTS_PER_RUN) {
          summary.deferred += 1;
          continue;
        }
        const delivered = await this.slack.send(this.toSlack(alert));
        if (!delivered) {
          // Not recorded, so the next run tries again.
          summary.deferred += 1;
          continue;
        }
        summary.alertsSent += 1;
        this.recordSent(alert, now);
      }

      this.log.info("run", "alert run complete", { ...summary });
      if (summary.failedChecks.length === 0) this.heartbeat.ping("ALERTS");
      return summary;
    } finally {
      this.running = false;
    }
  }

  /** a. Failure rate per provider over OUTBOUND event_logs rows, last 15 min. */
  async checkProviderErrorRate(now: Date): Promise<Alert[]> {
    const groups = await this.prisma.eventLog.groupBy({
      by: ["provider", "success"],
      where: {
        direction: "OUTBOUND",
        provider: { not: null },
        createdAt: { gte: new Date(now.getTime() - PROVIDER_WINDOW_MS) },
      },
      _count: { _all: true },
    });

    const byProvider = new Map<string, { total: number; failures: number }>();
    for (const g of groups) {
      if (!g.provider) continue;
      const entry = byProvider.get(g.provider) ?? { total: 0, failures: 0 };
      entry.total += g._count._all;
      if (!g.success) entry.failures += g._count._all;
      byProvider.set(g.provider, entry);
    }

    const alerts: Alert[] = [];
    for (const [provider, { total, failures }] of byProvider) {
      if (total < this.providerMinCalls) continue;
      const rate = failures / total;
      if (rate <= this.providerErrorRate) continue;
      alerts.push({
        key: `provider-error-rate:${provider}`,
        title: `${provider} error rate is ${(rate * 100).toFixed(1)}%`,
        body: `${failures} of ${total} calls to ${provider} failed in the last 15 min (threshold ${(this.providerErrorRate * 100).toFixed(0)}%).`,
      });
    }
    return alerts;
  }

  /**
   * b. Today's cost per organization (IST day, INR) against a fixed threshold
   * and against 3x its trailing 7-day daily average. USD rows convert with the
   * fx_rates row for the call's date or the nearest earlier one (ADR-0012),
   * falling back to the latest stored rate.
   */
  async checkOrgDailyCost(now: Date): Promise<Alert[]> {
    const todayStart = istDayStart(now);
    const weekStart = new Date(todayStart.getTime() - 7 * DAY);
    // No alert is possible below the lower of the two floors; skip those orgs in SQL.
    const floor = Math.min(this.dailyOrgCostInr, SPIKE_MIN_TODAY_INR);

    const rows = await this.prisma.$queryRaw<
      Array<{ organizationId: string; todayInr: number; avgInr: number }>
    >(Prisma.sql`
      WITH daily AS (
        SELECT "organizationId" AS org,
               ("occurredAt" >= ${todayStart}) AS is_today,
               "occurredAt"::date AS day,
               currency::text AS currency,
               SUM(cost) AS cost
        FROM usage_records
        WHERE "organizationId" IS NOT NULL
          AND cost IS NOT NULL
          AND "occurredAt" >= ${weekStart}
        GROUP BY 1, 2, 3, 4
      ),
      priced AS (
        SELECT d.org, d.is_today,
               CASE WHEN d.currency = 'USD' THEN d.cost * COALESCE(
                 (SELECT f."usdToInr" FROM fx_rates f WHERE f.date <= d.day ORDER BY f.date DESC LIMIT 1),
                 -- Older than every stored rate: the earliest one, as the usage reports do.
                 (SELECT f."usdToInr" FROM fx_rates f ORDER BY f.date ASC LIMIT 1)
               ) ELSE d.cost END AS inr
        FROM daily d
      )
      SELECT org AS "organizationId",
             COALESCE(SUM(inr) FILTER (WHERE is_today), 0)::float8 AS "todayInr",
             (COALESCE(SUM(inr) FILTER (WHERE NOT is_today), 0) / 7)::float8 AS "avgInr"
      FROM priced
      GROUP BY org
      HAVING COALESCE(SUM(inr) FILTER (WHERE is_today), 0) > ${floor}::numeric
    `);

    const alerts: Alert[] = [];
    for (const row of rows) {
      const today = Number(row.todayInr);
      const avg = Number(row.avgInr);
      if (today > this.dailyOrgCostInr) {
        alerts.push({
          key: `org-daily-cost:${row.organizationId}`,
          organizationId: row.organizationId,
          title: "Daily cost above threshold",
          body: `Today's cost is ${inr.format(today)}, above the ${inr.format(this.dailyOrgCostInr)} threshold.`,
        });
      }
      if (
        avg > 0 &&
        today > SPIKE_MIN_TODAY_INR &&
        today > SPIKE_MULTIPLIER * avg
      ) {
        alerts.push({
          key: `org-cost-spike:${row.organizationId}`,
          organizationId: row.organizationId,
          title: "Daily cost jumped",
          body: `Today's cost is ${inr.format(today)}, ${(today / avg).toFixed(1)}x the 7-day daily average of ${inr.format(avg)}.`,
        });
      }
    }
    if (alerts.length === 0) return alerts;

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(alerts.map((a) => a.organizationId!))] } },
      select: { id: true, name: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    for (const alert of alerts) {
      const id = alert.organizationId!;
      alert.title = `${alert.title}: ${names.get(id) ?? id}`;
      alert.fields = [{ label: "Organization ID", value: id }];
    }
    return alerts;
  }

  /** c. Usage rows stored with no price in the last 24 h. One alert in total. */
  async checkUnpricedUsage(now: Date): Promise<Alert[]> {
    const groups = await this.prisma.usageRecord.groupBy({
      by: ["provider", "model"],
      where: {
        cost: null,
        occurredAt: { gte: new Date(now.getTime() - UNPRICED_WINDOW_MS) },
      },
      _count: { _all: true },
    });
    if (groups.length === 0) return [];

    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    const top = [...groups]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 5);
    return [
      {
        key: "unpriced-usage",
        title: `${total} usage rows have no price`,
        body: "Calls in the last 24 h were recorded with cost = null. Add the missing price rows.",
        fields: top.map((g) => ({
          label: `${g.provider} / ${g.model}`,
          value: `${g._count._all} rows`,
        })),
      },
    ];
  }

  /** d. Cron jobs with no successful run inside their window. */
  async checkStaleCrons(now: Date): Promise<Alert[]> {
    const results = await Promise.all(
      STALE_CRON_RULES.map(async (rule): Promise<Alert | null> => {
        const cutoff = new Date(now.getTime() - rule.maxAgeMs);
        const recent = await this.prisma.eventLog.findFirst({
          where: { eventName: rule.eventName, createdAt: { gte: cutoff } },
          select: { id: true },
        });
        if (recent) return null;

        const everRan = await this.prisma.eventLog.findFirst({
          where: { eventName: rule.eventName },
          select: { id: true },
        });
        if (!everRan) return null;

        let detail = "";
        if (rule.onlyWithOverdueExtractions) {
          const overdue = await this.prisma.chatSession.count({
            where: { extractionDueAt: { lte: cutoff } },
          });
          if (overdue === 0) return null;
          detail = ` ${overdue} conversation(s) are waiting for extraction.`;
        }
        return {
          key: `stale-cron:${rule.job}`,
          title: `${rule.label} has not run`,
          body: `No successful ${rule.label.toLowerCase()} run in the last ${describeWindow(rule.maxAgeMs)}.${detail}`,
        };
      }),
    );
    return results.filter((a): a is Alert => a !== null);
  }

  /** Keys that fired inside the cooldown: event_logs, plus this instance's memory. */
  private async recentlyAlertedKeys(now: Date): Promise<Set<string>> {
    const since = now.getTime() - this.cooldownMs;
    const keys = new Set<string>();
    for (const [key, at] of this.sentAt) {
      if (at >= since) keys.add(key);
      else this.sentAt.delete(key);
    }
    try {
      const rows = await this.prisma.eventLog.findMany({
        where: {
          eventName: ALERT_SENT_EVENT,
          createdAt: { gte: new Date(since) },
        },
        select: { metadata: true },
        take: 1000,
      });
      for (const row of rows) {
        const meta = row.metadata as { alertKey?: unknown } | null;
        if (typeof meta?.alertKey === "string") keys.add(meta.alertKey);
      }
    } catch (err) {
      this.log.error("recentlyAlertedKeys", "cooldown lookup failed", err);
    }
    return keys;
  }

  private recordSent(alert: Alert, now: Date): void {
    this.sentAt.set(alert.key, now.getTime());
    this.internalLog.logCompleted(ALERT_SENT_EVENT, {
      organizationId: alert.organizationId,
      metadata: { alertKey: alert.key, title: alert.title },
    });
  }

  private toSlack(alert: Alert): { text: string; fields?: SlackField[] } {
    const lines = [
      `:rotating_light: *[${escapeSlack(this.environment)}] ${escapeSlack(alert.title)}*`,
      escapeSlack(alert.body),
    ];
    if (this.statusUrl) lines.push(`<${this.statusUrl}|Open the status page>`);
    return { text: lines.join("\n"), fields: alert.fields };
  }
}
