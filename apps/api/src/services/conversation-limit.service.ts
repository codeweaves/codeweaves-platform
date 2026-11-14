import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import type { ChatSource } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { EmailService } from "./email.service";
import { EmailTemplateService } from "./email-template.service";
import { OrganizationLoggerService } from "../common/logger/organization.logger";
import { InternalEventLogger } from "../common/events/internal.logger";
import { AppLogger } from "../common/logger/app-logger";
import { SUPER_ADMIN_ROLE_KEY } from "../common/rbac";
import type { UpdateOrganizationContractDto } from "../models/organization.dto";

/** Usage alert levels, in percent of the limit. Ascending. */
export const CONVERSATION_LIMIT_THRESHOLDS = [50, 90, 100] as const;

/** Upper bound on alert recipients, so one alert is always one small send. */
const MAX_ALERT_RECIPIENTS = 20;

/** Sources that count as a conversation. DEMO is a dashboard preview. */
const COUNTED_SOURCES: ChatSource[] = ["WIDGET", "WHATSAPP"];

const CONTRACT_SELECT = {
  id: true,
  contractStartDate: true,
  conversationLimit: true,
  conversationLimitSetAt: true,
} satisfies Prisma.OrganizationSelect;

type ContractRow = Prisma.OrganizationGetPayload<{
  select: typeof CONTRACT_SELECT;
}>;

/** Why an alert email did not reach the provider. Never holds addresses. */
type SendFailure =
  "NO_RECIPIENTS" | "RENDER_FAILED" | "PROVIDER_FAILED" | "ERROR";

/** Counts only, never addresses: these go into event_logs metadata. */
type SendResult =
  | { sent: true; recipients: number; delivered: number; failed: number }
  | { sent: false; reason: SendFailure; recipients?: number };

export interface OrganizationContract {
  /** `YYYY-MM-DD`, display only. */
  contractStartDate: string | null;
  conversationLimit: number | null;
  /** ISO timestamp. Usage counts conversations created from this moment. */
  conversationLimitSetAt: string | null;
  conversationsUsed: number;
  /** `limit - used`, never below 0. Null when there is no limit. */
  conversationsRemaining: number | null;
  /** Whole percent, rounded down. Can exceed 100. Null when there is no limit. */
  percentUsed: number | null;
  /** Alerts sent for the current limit, lowest threshold first. */
  alerts: { threshold: number; sentAt: string }[];
}

/**
 * Per-organization conversation limit (ADR-0022).
 *
 * The limit is ALERT ONLY: nothing here may block or slow a chat. Usage is the
 * number of WIDGET and WHATSAPP sessions created since `conversationLimitSetAt`.
 * Super admins get one email per threshold per limit.
 */
@Injectable()
export class ConversationLimitService {
  private readonly log = new AppLogger(ConversationLimitService.name);
  private readonly dashboardUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly email: EmailService,
    private readonly orgLogger: OrganizationLoggerService,
    private readonly internalLog: InternalEventLogger,
    config: ConfigService,
  ) {
    this.dashboardUrl = (
      config.get<string>("DASHBOARD_URL") || "http://localhost:3000"
    ).replace(/\/+$/, "");
  }

  async getContract(organizationId: string): Promise<OrganizationContract> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: CONTRACT_SELECT,
    });
    if (!org) throw new NotFoundException("Organization not found");
    return this.toContract(org);
  }

  /**
   * Set the contract start date and/or the limit. A `conversationLimit` key in
   * the body always re-stamps `conversationLimitSetAt`, even when the number is
   * unchanged: submitting a limit is how staff restart the count.
   */
  async updateContract(
    organizationId: string,
    dto: UpdateOrganizationContractDto,
  ): Promise<OrganizationContract> {
    const before = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: CONTRACT_SELECT,
    });
    if (!before) throw new NotFoundException("Organization not found");

    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.contractStartDate !== undefined) {
      data.contractStartDate =
        dto.contractStartDate === null
          ? null
          : new Date(`${dto.contractStartDate}T00:00:00.000Z`);
    }
    if (dto.conversationLimit !== undefined) {
      data.conversationLimit = dto.conversationLimit;
      data.conversationLimitSetAt =
        dto.conversationLimit === null ? null : new Date();
    }

    // `deletedAt: null` on the write too: an organization deleted between the
    // read above and this write must get a 404, not a 200.
    let after: ContractRow;
    try {
      after = await this.prisma.organization.update({
        where: { id: organizationId, deletedAt: null },
        data,
        select: CONTRACT_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException("Organization not found");
      }
      throw error;
    }

    await this.orgLogger.logOrganizationContractUpdated(organizationId, {
      request: dto,
      before: serializeRow(before),
      after: serializeRow(after),
    });
    this.log.info("updateContract", "organization contract updated", {
      organizationId,
      conversationLimit: after.conversationLimit,
    });

    return this.toContract(after);
  }

  /**
   * Called after every new WIDGET or WHATSAPP session. Sends the 50, 90 and
   * 100 percent alerts. Fire-and-forget: it never throws, so a failure here can
   * never reach the chat.
   *
   * Query budget, because this runs on every new conversation:
   *   1. The organization's limit fields. No limit: stop. This is the common
   *      case and costs one indexed lookup.
   *   2. The alerts already sent for this limit (unique index). All three sent:
   *      stop. Without this step, an organization past 100% would pay for a
   *      count on every conversation for the rest of the contract.
   *   3. A count of sessions. It is not capped: the alert reports this number
   *      and sales may bill from it, so it must be the real count even when the
   *      alert goes out late (a retried send, or a jump past the limit). A cap
   *      would only save work while usage is above the limit and the 100%
   *      alert is still unsent, a short window that step 2 then closes.
   *   4. Only on a crossing: insert the alert rows, read the recipients, send.
   * We check the alert rows instead of caching state in memory because the API
   * runs on several instances and a cache would need its own invalidation when
   * staff change the limit.
   *
   * Delivery: each super admin gets their own email, so a bad address never
   * blocks the others and no address is shared. An alert row means "the
   * provider accepted this threshold's email for at least one super admin".
   * The row is inserted first, as the claim that stops a concurrent check from
   * sending too. When no email is accepted (no recipient, render error, every
   * send refused), this call deletes exactly the rows it inserted, so the next
   * new conversation claims and tries again. Retries continue, one per new
   * conversation, until at least one recipient's email is accepted. Recipients
   * that failed while another succeeded are not retried.
   */
  async checkAfterNewConversation(agentId: string): Promise<void> {
    try {
      const org = await this.prisma.organization.findFirst({
        where: { agents: { some: { id: agentId } }, deletedAt: null },
        select: {
          id: true,
          name: true,
          conversationLimit: true,
          conversationLimitSetAt: true,
        },
      });
      const limit = org?.conversationLimit;
      const limitSetAt = org?.conversationLimitSetAt;
      if (!org || limit == null || limitSetAt == null) return;

      const sentRows = await this.prisma.conversationLimitAlert.findMany({
        where: { organizationId: org.id, limitSetAt },
        select: { threshold: true },
      });
      const sent = new Set(sentRows.map((r) => r.threshold));
      if (CONVERSATION_LIMIT_THRESHOLDS.every((t) => sent.has(t))) return;

      const used = await this.prisma.chatSession.count({
        where: usageWhere(org.id, limitSetAt),
      });

      const due = CONVERSATION_LIMIT_THRESHOLDS.filter(
        (t) => !sent.has(t) && thresholdReached(used, limit, t),
      );
      if (due.length === 0) return;

      // The unique key (organization, limit, threshold) decides who sends.
      // Two conversations crossing at once both try to insert; ON CONFLICT DO
      // NOTHING returns the row only to the one that won. The loser stops
      // here, so a successful send is never doubled. If the winner's send
      // fails, it deletes only its own rows, which no other call can hold:
      // a later insert of the same key can only succeed after that delete.
      const inserted =
        await this.prisma.conversationLimitAlert.createManyAndReturn({
          data: due.map((threshold) => ({
            organizationId: org.id,
            limitSetAt,
            threshold,
            conversationLimit: limit,
            conversationsUsed: used,
          })),
          skipDuplicates: true,
          select: { threshold: true },
        });
      if (inserted.length === 0) return;

      // One email for the highest new threshold. A jump from 40% to 100% sends
      // one "100%" email, not three; the lower rows are still recorded.
      const thresholds = inserted.map((r) => r.threshold);
      const threshold = Math.max(...thresholds);
      const result = await this.sendAlert(
        { id: org.id, name: org.name },
        threshold,
        used,
        limit,
      );
      if (result.sent) {
        this.internalLog.logCompleted("CONVERSATION_LIMIT_ALERT_SENT", {
          agentId,
          organizationId: org.id,
          metadata: {
            threshold,
            conversationsUsed: used,
            conversationLimit: limit,
            recipients: result.recipients,
            delivered: result.delivered,
            failed: result.failed,
          },
        });
        return;
      }

      this.log.warn(
        "checkAfterNewConversation",
        "conversation limit alert not sent",
        {
          organizationId: org.id,
          threshold,
          reason: result.reason,
        },
      );
      this.internalLog.logFailed(
        "CONVERSATION_LIMIT_ALERT_FAILED",
        result.reason,
        {
          agentId,
          organizationId: org.id,
          metadata: {
            threshold,
            reason: result.reason,
            conversationsUsed: used,
            conversationLimit: limit,
            ...(result.recipients !== undefined
              ? { recipients: result.recipients }
              : {}),
          },
        },
      );
      await this.releaseClaim(org.id, limitSetAt, thresholds);
    } catch (error) {
      this.log.warn(
        "checkAfterNewConversation",
        "conversation limit check failed",
        {
          agentId,
          err: error instanceof Error ? error.message : String(error),
        },
      );
      this.internalLog.logFailed("CONVERSATION_LIMIT_CHECK_FAILED", error, {
        agentId,
      });
    }
  }

  /**
   * Email the alert to the super admins: rendered once, then one email per
   * recipient, so one bad address never blocks the others and no address is
   * shown to anyone else. The alert counts as sent when at least one
   * recipient's email was accepted. Never throws: every way the alert can fail
   * comes back as `sent: false` with a reason, so the caller can release its
   * claim on the threshold.
   */
  private async sendAlert(
    org: { id: string; name: string },
    threshold: number,
    used: number,
    limit: number,
  ): Promise<SendResult> {
    try {
      const recipients = await this.loadRecipients();
      if (recipients.length === 0) {
        return { sent: false, reason: "NO_RECIPIENTS" };
      }

      const format = (n: number) => n.toLocaleString("en-US");
      let rendered: { subject: string; html: string; text: string };
      try {
        rendered = await this.emailTemplates.render(
          "CONVERSATION_LIMIT_ALERT",
          {
            orgName: org.name,
            thresholdPercent: String(threshold),
            conversationsUsed: format(used),
            conversationLimit: format(limit),
            conversationsRemaining: format(Math.max(limit - used, 0)),
            organizationUrl: `${this.dashboardUrl}/dashboard/organizations/${org.id}`,
          },
        );
      } catch (error) {
        this.log.warn("sendAlert", "alert template failed to render", {
          organizationId: org.id,
          err: error instanceof Error ? error.message : String(error),
        });
        return { sent: false, reason: "RENDER_FAILED" };
      }

      // One email per recipient, one after another. With a shared `to` list,
      // the provider rejects the whole request for one bad address, and every
      // super admin sees the others' addresses. Sequential, because the
      // provider's default rate limit is low. EmailService.send returns null
      // when the provider did not accept the email; it is not expected to
      // throw, but a throw counts as one failed recipient, not a failed alert.
      let delivered = 0;
      for (const to of recipients) {
        let accepted: unknown = null;
        try {
          accepted = await this.email.send({
            to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: { type: "CONVERSATION_LIMIT_ALERT" },
            organizationId: org.id,
          });
        } catch {
          accepted = null;
        }
        if (accepted) delivered++;
      }
      const failed = recipients.length - delivered;

      if (delivered === 0) {
        return {
          sent: false,
          reason: "PROVIDER_FAILED",
          recipients: recipients.length,
        };
      }
      if (failed > 0) {
        this.log.warn("sendAlert", "alert email failed for some recipients", {
          organizationId: org.id,
          threshold,
          recipients: recipients.length,
          delivered,
          failed,
        });
      }
      return { sent: true, recipients: recipients.length, delivered, failed };
    } catch (error) {
      this.log.warn("sendAlert", "alert send failed", {
        organizationId: org.id,
        err: error instanceof Error ? error.message : String(error),
      });
      return { sent: false, reason: "ERROR" };
    }
  }

  /**
   * Super admin email addresses, at most MAX_ALERT_RECIPIENTS. Reads one row
   * past the cap so that going over it costs no extra query on the normal
   * path; only then is the exact total counted, for the warning.
   */
  private async loadRecipients(): Promise<string[]> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      roleAssignments: {
        some: { roleKey: SUPER_ADMIN_ROLE_KEY, deletedAt: null },
      },
    };
    const rows = await this.prisma.user.findMany({
      where,
      select: { email: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ALERT_RECIPIENTS + 1,
    });
    if (rows.length > MAX_ALERT_RECIPIENTS) {
      const total = await this.prisma.user.count({ where }).catch(() => null);
      this.log.warn(
        "loadRecipients",
        "more super admins than the alert recipient cap",
        {
          superAdmins: total,
          cap: MAX_ALERT_RECIPIENTS,
        },
      );
    }
    return rows.slice(0, MAX_ALERT_RECIPIENTS).map((r) => r.email);
  }

  /**
   * Undo this call's claim on the thresholds after a failed send, so the next
   * new conversation tries again. Deletes only the rows this call inserted.
   * Never throws: a failed delete leaves the alert marked as sent, which is
   * logged so staff can see it.
   */
  private async releaseClaim(
    organizationId: string,
    limitSetAt: Date,
    thresholds: number[],
  ): Promise<void> {
    try {
      await this.prisma.conversationLimitAlert.deleteMany({
        where: { organizationId, limitSetAt, threshold: { in: thresholds } },
      });
    } catch (error) {
      this.log.warn(
        "releaseClaim",
        "could not release the alert claim; the alert will not be retried",
        {
          organizationId,
          thresholds,
          err: error instanceof Error ? error.message : String(error),
        },
      );
      this.internalLog.logFailed(
        "CONVERSATION_LIMIT_ALERT_RELEASE_FAILED",
        error,
        {
          organizationId,
          metadata: { thresholds },
        },
      );
    }
  }

  private async toContract(org: ContractRow): Promise<OrganizationContract> {
    const base = {
      contractStartDate: org.contractStartDate
        ? org.contractStartDate.toISOString().slice(0, 10)
        : null,
    };
    const limit = org.conversationLimit;
    const limitSetAt = org.conversationLimitSetAt;
    if (limit == null || limitSetAt == null) {
      return {
        ...base,
        conversationLimit: null,
        conversationLimitSetAt: null,
        conversationsUsed: 0,
        conversationsRemaining: null,
        percentUsed: null,
        alerts: [],
      };
    }

    const [used, alerts] = await Promise.all([
      this.prisma.chatSession.count({ where: usageWhere(org.id, limitSetAt) }),
      this.prisma.conversationLimitAlert.findMany({
        where: { organizationId: org.id, limitSetAt },
        select: { threshold: true, createdAt: true },
        orderBy: { threshold: "asc" },
      }),
    ]);

    return {
      ...base,
      conversationLimit: limit,
      conversationLimitSetAt: limitSetAt.toISOString(),
      conversationsUsed: used,
      conversationsRemaining: Math.max(limit - used, 0),
      percentUsed: Math.floor((used * 100) / limit),
      alerts: alerts.map((a) => ({
        threshold: a.threshold,
        sentAt: a.createdAt.toISOString(),
      })),
    };
  }
}

/** The sessions that count against a limit stamped at `since`. */
function usageWhere(
  organizationId: string,
  since: Date,
): Prisma.ChatSessionWhereInput {
  return {
    agent: { organizationId },
    source: { in: COUNTED_SOURCES },
    createdAt: { gte: since },
  };
}

/** Integer maths, so 90% of 17000 is exactly 15300 with no float rounding. */
function thresholdReached(
  used: number,
  limit: number,
  threshold: number,
): boolean {
  return used * 100 >= limit * threshold;
}

function serializeRow(row: ContractRow) {
  return {
    contractStartDate: row.contractStartDate
      ? row.contractStartDate.toISOString().slice(0, 10)
      : null,
    conversationLimit: row.conversationLimit,
    conversationLimitSetAt: row.conversationLimitSetAt?.toISOString() ?? null,
  };
}
