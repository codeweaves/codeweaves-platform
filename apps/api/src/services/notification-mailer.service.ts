import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EmailService } from './email.service';
import { EmailTemplateService } from './email-template.service';
import type { EmailTemplateKey } from './email-template.registry';
import { AppLogger } from '../common/logger/app-logger';

/**
 * Hard ceiling on recipients per notification email.
 *
 * Two jobs: it bounds the blast radius if an organization ever accumulates a
 * huge member list, and it stops a mistyped recipient list from turning one
 * handover into a bulk send that hurts our sending reputation.
 */
const MAX_RECIPIENTS = 20;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Decides WHO receives a notification email, renders it, and hands it to the
 * transport. Sits between NotificationService (which knows what happened) and
 * EmailService (which knows how to talk to Resend).
 *
 * ── HARD INVARIANT: PLATFORM STAFF ARE NEVER EMAILED ──────────────────────
 * A platform admin (ADMIN/SUPER_ADMIN with no organization of their own) must
 * never receive a notification email — not for handover, and not for any type
 * added later (knowledge-base edits, data capture, whatever comes next). They
 * see everything in the dashboard; mailing them every customer's activity would
 * be unusable and would put one org's operational detail in front of someone
 * outside it.
 *
 * This is structural, not a policy check sprinkled at call sites: there are
 * exactly TWO ways an address can be resolved here, and neither can yield a
 * platform admin —
 *
 *  1. EMPTY recipient list (the default) → `users WHERE organizationId = <org>`.
 *     A platform admin has `organizationId = null`, so they cannot match.
 *  2. EXPLICIT recipient list → addresses a customer typed into their own
 *     agent's settings. Shape-validated and capped, but NOT ownership-verified
 *     and NOT necessarily org members — that is the point (a shared support
 *     inbox has no dashboard login). Never treat this path as tenant-scoped, and
 *     never put anything in the message a non-member shouldn't see. The deep
 *     link is a notification id, not a session bearer — see
 *     NotificationService.deepLink.
 *
 * There is deliberately no "notify all admins" path. If you are adding a new
 * notification type and reach for one, don't: use the in-app bell, which already
 * shows platform staff every org (HandoverGateway.emitNotification).
 *
 * If self-serve recipients ever need to be trusted, they require a
 * double-opt-in `verifiedAt` before they can receive mail.
 *
 * Every path is best-effort: this never throws, because the DB write that
 * triggered it is already durable and a mail failure must not roll it back.
 */
@Injectable()
export class NotificationMailerService {
  private readonly log = new AppLogger(NotificationMailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly templates: EmailTemplateService,
  ) {}

  async send(input: {
    organizationId: string;
    templateKey: EmailTemplateKey;
    vars: Record<string, string>;
    /** Explicit addresses. Empty ⇒ fall back to every member of the org. */
    recipients: string[];
    /** Resend tag so sends can be sliced by type in the provider dashboard. */
    tagType: string;
  }): Promise<void> {
    try {
      const to = await this.resolveRecipients(input.organizationId, input.recipients);
      if (to.length === 0) {
        this.log.warn('send', 'no recipients resolved — skipping email', {
          organizationId: input.organizationId,
          templateKey: input.templateKey,
        });
        return;
      }

      const { subject, html, text } = await this.templates.render(
        input.templateKey,
        input.vars,
      );

      await this.email.send({
        to,
        subject,
        html,
        text,
        tags: { type: input.tagType },
      });
    } catch (err) {
      // Swallowed on purpose — see the class doc.
      this.log.warn('send', 'notification email failed (ignored)', {
        organizationId: input.organizationId,
        templateKey: input.templateKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Explicit list wins; empty list means "everyone in the organization".
   *  See the class doc for the two-path invariant this implements. */
  private async resolveRecipients(
    organizationId: string,
    explicit: string[],
  ): Promise<string[]> {
    if (explicit.length > 0) return dedupeEmails(explicit);

    const members = await this.prisma.user.findMany({
      // The `organizationId` equality filter is what enforces the
      // "platform staff are never emailed" invariant (see the class doc): a
      // platform admin has organizationId = null and therefore cannot match.
      // Do not relax this to an OR / role-based filter.
      where: { organizationId, deletedAt: null },
      select: { email: true },
      take: MAX_RECIPIENTS,
    });
    return dedupeEmails(members.map((m) => m.email));
  }
}

/** Lowercase, validate, de-duplicate, cap. */
function dedupeEmails(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    seen.add(email);
    if (seen.size >= MAX_RECIPIENTS) break;
  }
  return [...seen];
}
