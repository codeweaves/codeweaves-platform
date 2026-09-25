import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { ChatSource, ConsentAction } from "@prisma/client";
import type { ConsentConfig } from "@repo/validation";
import { AppLogger } from "../common/logger/app-logger";
import { TracerService } from "../common/tracer/tracer.service";
import { WidgetEventLogger } from "../common/events/widget.logger";
import { PrismaService } from "./prisma.service";
import type { VisitorIdentity } from "./web-visitor";
import {
  computeNoticeHash,
  publicNoticeView,
  readConsentConfig,
  requiresConsent,
  type PublicNoticeView,
} from "../utils/consent-notice";

/** Error code the widget reacts to by showing the consent prompt again. */
export const CONSENT_REQUIRED_CODE = "CONSENT_REQUIRED";
/** Error code for a GRANT made against a notice that has since changed. */
export const CONSENT_NOTICE_CHANGED_CODE = "CONSENT_NOTICE_CHANGED";

/**
 * The refusal carries the live notice, so a widget whose cached config says
 * "notice off" (the owner just turned consent on) can show the notice and the
 * button at once instead of leaving the visitor with nothing to accept.
 */
export class ConsentRequiredException extends ForbiddenException {
  constructor(notice?: PublicNoticeView, noticeHash?: string) {
    super({
      statusCode: 403,
      code: CONSENT_REQUIRED_CODE,
      message: "Please accept the privacy notice to start the chat.",
      ...(notice && noticeHash ? { notice, noticeHash } : {}),
    });
  }
}

export interface RecordConsentInput {
  agentId: string;
  organizationId: string;
  source: ChatSource;
  visitor: VisitorIdentity & { visitorId: string };
  action: ConsentAction;
  method: string;
  /** The hash of the notice the visitor saw. Required for GRANTED. */
  noticeHash?: string;
}

export type RecordConsentResult =
  | { recorded: false }
  | {
      recorded: true;
      consentId: string;
      action: ConsentAction;
      noticeHash: string;
    };

/**
 * Chat-start consent (DPDP s.6), see ADR-0004.
 *
 * `visitor_consents` is an append-only event log: every grant and withdrawal
 * is a new row carrying a snapshot of the notice the visitor saw. The current
 * state of a visitor is their latest row. The notice text, link and mode are
 * the client's; this service only records and enforces.
 */
@Injectable()
export class ConsentService {
  private readonly log = new AppLogger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracer: TracerService,
    private readonly widgetLog: WidgetEventLogger,
  ) {}

  /** The agent's live consent settings, from its stored widget theme. */
  async loadConfig(agentId: string): Promise<ConsentConfig> {
    return (await this.loadConfigWithOrg(agentId)).config;
  }

  private async loadConfigWithOrg(
    agentId: string,
  ): Promise<{ config: ConsentConfig; organizationId: string | undefined }> {
    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId },
      select: { config: true, agent: { select: { organizationId: true } } },
    });
    return {
      config: readConsentConfig(theme?.config),
      organizationId: theme?.agent.organizationId,
    };
  }

  /**
   * The consent gate. Returns the consent id to stamp on a new session, or
   * null when the agent is not in consent mode. Throws ConsentRequiredException
   * when consent mode is on and this visitor's latest decision is not a GRANT
   * for the live notice.
   *
   * Called when a chat session is created (ChatService) and before every
   * speech-to-text call (voice), because STT sends audio to a third party
   * before any session exists.
   *
   * Only WhatsApp is exempt (its in-thread consent is a later phase). DEMO is
   * NOT exempt: `source` is a word the caller sends, with no login behind it,
   * so exempting it would let any caller skip the gate by claiming DEMO.
   *
   * The theme and the latest decision are read in parallel: one round trip.
   */
  async assertConsented(
    agentId: string,
    source: ChatSource,
    visitorId: string | undefined,
  ): Promise<string | null> {
    if (source === "WHATSAPP") return null;
    const [{ config, organizationId }, latest] = await Promise.all([
      this.loadConfigWithOrg(agentId),
      visitorId
        ? this.prisma.visitorConsent.findFirst({
            where: { agentId, visitorId },
            orderBy: { createdAt: "desc" },
            select: { id: true, action: true, noticeHash: true },
          })
        : Promise.resolve(null),
    ]);
    if (!requiresConsent(config)) return null;

    const currentHash = computeNoticeHash(config);
    if (
      visitorId &&
      latest?.action === "GRANTED" &&
      latest.noticeHash === currentHash
    ) {
      return latest.id;
    }
    this.widgetLog.logConsentRequired({
      agentId,
      organizationId,
      visitorId,
      metadata: {
        source,
        reason: !visitorId
          ? "no_visitor_id"
          : !latest
            ? "no_decision"
            : latest.action === "WITHDRAWN"
              ? "withdrawn"
              : "notice_changed",
      },
    });
    throw new ConsentRequiredException(publicNoticeView(config), currentHash);
  }

  /**
   * Record one consent decision.
   *
   * - Only consent mode records anything. In notice mode, or with the notice
   *   off, nobody agreed to anything, so it returns `{ recorded: false }`.
   * - A GRANT must name the notice the visitor saw. If the client changed the
   *   notice since the widget loaded it, the grant is refused with the current
   *   notice so the widget can show it and ask again.
   * - A WITHDRAWAL always succeeds (s.6(4): as easy as giving consent) and
   *   expires the visitor's open bot sessions on this agent (s.6(6): stop
   *   processing). Sessions a teammate is handling are left to the handover
   *   flow, whose idle sweep closes them.
   *
   * The snapshot is taken from the server's copy of the notice, never from
   * the request, so a visitor cannot put words into their own consent record.
   */
  async record(input: RecordConsentInput): Promise<RecordConsentResult> {
    const config = await this.loadConfig(input.agentId);
    if (!requiresConsent(config)) return { recorded: false };

    const currentHash = computeNoticeHash(config);
    if (input.action === "GRANTED" && input.noticeHash !== currentHash) {
      throw new ConflictException({
        statusCode: 409,
        code: CONSENT_NOTICE_CHANGED_CODE,
        message: "The privacy notice has changed. Please review it again.",
        notice: publicNoticeView(config),
        noticeHash: currentHash,
      });
    }

    const row = await this.prisma.visitorConsent.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        visitorId: input.visitor.visitorId,
        source: input.source,
        action: input.action,
        method: input.method,
        noticeText: config.noticeText,
        linkText: config.linkText,
        privacyPolicyUrl: config.privacyPolicyUrl,
        buttonLabel: config.buttonLabel,
        noticeHash: currentHash,
        ipHash: input.visitor.ipHash ?? null,
      },
      select: { id: true },
    });

    let expiredSessions = 0;
    if (input.action === "WITHDRAWN") {
      expiredSessions = (
        await this.prisma.chatSession.updateMany({
          where: {
            agentId: input.agentId,
            visitorId: input.visitor.visitorId,
            status: "ACTIVE",
            handoverState: "NONE",
          },
          data: { status: "EXPIRED" },
        })
      ).count;
    }

    // Accountability. The visitorId stays out of the audit payload on purpose:
    // erasure deletes the consent row, and the audit trail must not keep a
    // pseudonymous handle to an erased visitor.
    await this.tracer.logAuditEvent(
      row.id,
      input.action === "GRANTED"
        ? "VISITOR_CONSENT_GRANTED"
        : "VISITOR_CONSENT_WITHDRAWN",
      {
        agentId: input.agentId,
        source: input.source,
        method: input.method,
        noticeHash: currentHash,
        ...(input.action === "WITHDRAWN" ? { expiredSessions } : {}),
      },
      { organizationId: input.organizationId, agentId: input.agentId },
    );
    this.widgetLog.logConsentDecision({
      agentId: input.agentId,
      organizationId: input.organizationId,
      visitorId: input.visitor.visitorId,
      action: input.action,
      metadata: {
        method: input.method,
        noticeHash: currentHash,
        expiredSessions,
      },
    });
    this.log.info("record", `consent ${input.action} agent=${input.agentId}`, {
      consentId: row.id,
      expiredSessions,
    });

    return {
      recorded: true,
      consentId: row.id,
      action: input.action,
      noticeHash: currentHash,
    };
  }
}
