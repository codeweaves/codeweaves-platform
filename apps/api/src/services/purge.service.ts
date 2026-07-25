import { Injectable, NotFoundException } from '@nestjs/common';
import { AppLogger } from '../common/logger/app-logger';
import { CryptoService } from '../common/crypto/crypto.service';
import { TracerService } from '../common/tracer/tracer.service';
import { PrismaService } from './prisma.service';
import { SupabaseStorageService } from './supabase-storage.service';

/** Row counts removed per table — returned to the caller as proof of erasure. */
export interface VisitorErasureResult {
  visitorId: string;
  organizationId: string;
  sessions: number;
  piiTokens: number;
  chatTraces: number;
  llmUsage: number;
  eventLogs: number;
}

/** DPDP right-to-access: a summary of what we hold on one visitor (S3). */
export interface VisitorDataSummary {
  visitorId: string;
  organizationId: string;
  generatedAt: string;
  sessions: Array<{
    sessionId: string;
    source: string;
    status: string;
    startedAt: Date;
    messageCount: number;
  }>;
  totalMessages: number;
  /** Captured lead fields, decrypted for the data principal. */
  collectedData: Array<{
    sessionId: string;
    extractedAt: Date;
    fields: Record<string, unknown>;
  }>;
  /** Row counts in operational stores (content not reproduced here). */
  recordCounts: {
    aiTraces: number;
    eventLogs: number;
    piiTokens: number;
    llmUsage: number;
  };
  /** Why this data is processed — DPDP asks for processing purposes. */
  processingPurposes: string[];
}

export interface OrgErasureResult {
  organizationId: string;
  agents: number;
  users: number;
  sessions: number;
  piiTokens: number;
  chatTraces: number;
  llmUsage: number;
  eventLogs: number;
  auditLogs: number;
  files: number;
  invitations: number;
}

/**
 * PurgeService — the DPDP erasure engine (S2).
 *
 * Deletes a data subject's complete footprint. Two entry points:
 *   - eraseVisitor: one visitor (hashed-IP / WhatsApp phone) within one org —
 *     the Art. "right to erasure" path, honoured on a verified request.
 *   - eraseOrganization: hard-deletes EVERYTHING belonging to an org —
 *     offboarding / test-data cleanup. Irreversible.
 *
 * Design notes (deliberate):
 *   - `chat_traces`, `pii_tokens`, `event_logs`, `llm_usage`, `audit_logs`
 *     have NO foreign keys (observability tables must never fail an insert),
 *     so they are deleted explicitly by their indexed scope columns — cascade
 *     cannot reach them.
 *   - Children-first, parents-last ordering, each step an independent
 *     `deleteMany`. NOT one giant transaction: an org purge can touch millions
 *     of rows and a single transaction would hold locks for its whole
 *     duration. Instead every step is idempotent — a re-run after a mid-way
 *     failure completes the remainder (nothing orphans: FK-less tables go
 *     first, FK'd tables cascade from their parent delete).
 *   - Org-wide deletes go by scope columns (organizationId / agentId) rather
 *     than loading id lists into memory — same behaviour at 10 sessions or
 *     10 million.
 */
@Injectable()
export class PurgeService {
  private readonly log = new AppLogger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracer: TracerService,
    private readonly storage: SupabaseStorageService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Right-to-access summary (S3): everything we hold on one visitor within
   * one org, as JSON — session list, captured (decrypted) lead fields, and
   * row counts in operational stores. DPDP requires a *summary* of data and
   * processing purposes, not a bulk export, so message content is counted
   * here rather than reproduced (transcripts remain viewable in the
   * dashboard's conversation view).
   */
  async summarizeVisitor(
    organizationId: string,
    visitorId: string,
  ): Promise<VisitorDataSummary> {
    const sessions = await this.prisma.chatSession.findMany({
      where: { visitorId, agent: { organizationId } },
      select: {
        id: true,
        sessionId: true,
        source: true,
        status: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
      // A visitor has a handful of sessions; the cap is a runaway guard, not
      // pagination.
      take: 500,
    });

    const dbIds = sessions.map((s) => s.id);
    const anySessionId = [...dbIds, ...sessions.map((s) => s.sessionId)];

    const [collected, aiTraces, eventLogs, piiTokens, llmUsage] =
      dbIds.length > 0
        ? await Promise.all([
            this.prisma.collectedData.findMany({
              where: { chatSessionId: { in: dbIds } },
              select: { chatSessionId: true, data: true, extractedAt: true },
            }),
            this.prisma.chatTrace.count({
              where: { sessionId: { in: anySessionId } },
            }),
            this.prisma.eventLog.count({
              where: {
                OR: [
                  { sessionId: { in: anySessionId } },
                  { visitorId, organizationId },
                ],
              },
            }),
            this.prisma.piiToken.count({
              where: { chatSessionId: { in: anySessionId } },
            }),
            this.prisma.llmUsage.count({
              where: { sessionId: { in: anySessionId } },
            }),
          ])
        : [[], 0, 0, 0, 0];

    const publicIdByDbId = new Map(sessions.map((s) => [s.id, s.sessionId]));

    return {
      visitorId,
      organizationId,
      generatedAt: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        source: s.source,
        status: s.status,
        startedAt: s.createdAt,
        messageCount: s._count.messages,
      })),
      totalMessages: sessions.reduce((sum, s) => sum + s._count.messages, 0),
      collectedData: collected.map((c) => ({
        sessionId: publicIdByDbId.get(c.chatSessionId) ?? c.chatSessionId,
        extractedAt: c.extractedAt,
        fields: this.crypto.decryptFieldValues(
          c.data as Record<string, unknown> | null,
        ),
      })),
      recordCounts: { aiTraces, eventLogs, piiTokens, llmUsage },
      processingPurposes: [
        'Operating the conversation service (generating replies, human handover, conversation history)',
        'Capturing contact/lead details the visitor chose to provide',
        'Platform security, abuse prevention and audit trails',
        'Service reliability: time-limited technical logs and AI traces',
        'Aggregated, non-identifying analytics for the business the visitor interacted with',
      ],
    };
  }

  /**
   * Erase one visitor's footprint within one organization.
   *
   * `visitorId` is what ChatSession stores: the hashed IP (`vh_…`) for
   * web/widget visitors or the phone number for WhatsApp. Scoped to the org
   * so the same physical visitor's data at a DIFFERENT org (hashes are
   * platform-global) is untouched — each fiduciary erases only their own.
   *
   * Idempotent: erasing an unknown visitor returns all-zero counts.
   */
  async eraseVisitor(
    organizationId: string,
    visitorId: string,
  ): Promise<VisitorErasureResult> {
    // Resolve the visitor's sessions within this org. Erasure is a rare,
    // explicit action — a visitor has at most a handful of sessions, so
    // loading the id list (unlike the org-wide path) is fine.
    const sessions = await this.prisma.chatSession.findMany({
      where: { visitorId, agent: { organizationId } },
      select: { id: true, sessionId: true, agentId: true },
    });

    const dbIds = sessions.map((s) => s.id);
    const publicIds = sessions.map((s) => s.sessionId);
    const agentIds = [...new Set(sessions.map((s) => s.agentId))];
    // Some tables store the DB session id, others the public sessionId — both
    // are UUIDs from disjoint value spaces, so matching the union is safe and
    // spares us caring which convention each writer used.
    const anySessionId = [...dbIds, ...publicIds];

    const result: VisitorErasureResult = {
      visitorId,
      organizationId,
      sessions: dbIds.length,
      piiTokens: 0,
      chatTraces: 0,
      llmUsage: 0,
      eventLogs: 0,
    };

    if (dbIds.length > 0) {
      result.piiTokens = (
        await this.prisma.piiToken.deleteMany({
          where: { chatSessionId: { in: anySessionId } },
        })
      ).count;

      result.chatTraces = (
        await this.prisma.chatTrace.deleteMany({
          where: { sessionId: { in: anySessionId } },
        })
      ).count;

      result.llmUsage = (
        await this.prisma.llmUsage.deleteMany({
          where: { sessionId: { in: anySessionId } },
        })
      ).count;
    }

    // Event logs can reference the visitor by session OR directly by
    // visitorId (e.g. pre-session rows). visitorId matches are org-scoped:
    // the same hash at another org belongs to that org's erasure, not this one.
    result.eventLogs = (
      await this.prisma.eventLog.deleteMany({
        where: {
          OR: [
            ...(anySessionId.length > 0
              ? [{ sessionId: { in: anySessionId } }]
              : []),
            { visitorId, organizationId },
            ...(agentIds.length > 0
              ? [{ visitorId, agentId: { in: agentIds } }]
              : []),
          ],
        },
      })
    ).count;

    if (dbIds.length > 0) {
      // Last: the sessions themselves. FK cascade removes chat_messages,
      // chat_message_metrics and collected_data in the same statement.
      await this.prisma.chatSession.deleteMany({ where: { id: { in: dbIds } } });
    }

    this.log.info(
      'eraseVisitor',
      `erased visitor within org=${organizationId}: sessions=${result.sessions} piiTokens=${result.piiTokens} traces=${result.chatTraces} llmUsage=${result.llmUsage} eventLogs=${result.eventLogs}`,
    );
    // Accountability: prove the erasure happened (counts only — no PII).
    await this.tracer.logAuditEvent(
      organizationId,
      'PRIVACY_VISITOR_ERASED',
      {
        sessions: result.sessions,
        piiTokens: result.piiTokens,
        chatTraces: result.chatTraces,
        llmUsage: result.llmUsage,
        eventLogs: result.eventLogs,
      },
      { organizationId },
    );

    return result;
  }

  /**
   * Hard-delete an organization and its complete footprint. Irreversible.
   *
   * Unlike OrganizationsService.delete() (soft-delete for day-to-day
   * offboarding), this is the DPDP-grade erasure: every table, including the
   * FK-less observability ones, plus storage objects. Idempotent per step —
   * re-run to completion after any mid-way failure.
   */
  async eraseOrganization(organizationId: string): Promise<OrgErasureResult> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const agents = await this.prisma.agent.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const agentIds = agents.map((a) => a.id);
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    const result: OrgErasureResult = {
      organizationId,
      agents: agentIds.length,
      users: userIds.length,
      sessions: 0,
      piiTokens: 0,
      chatTraces: 0,
      llmUsage: 0,
      eventLogs: 0,
      auditLogs: 0,
      files: 0,
      invitations: 0,
    };

    // 1) FK-less observability tables, by indexed scope columns (no id lists
    //    in memory — same cost profile at any org size).
    result.piiTokens = (
      await this.prisma.piiToken.deleteMany({ where: { organizationId } })
    ).count;
    if (agentIds.length > 0) {
      result.chatTraces = (
        await this.prisma.chatTrace.deleteMany({
          where: { agentId: { in: agentIds } },
        })
      ).count;
    }
    result.llmUsage = (
      await this.prisma.llmUsage.deleteMany({ where: { organizationId } })
    ).count;
    result.eventLogs = (
      await this.prisma.eventLog.deleteMany({
        where: {
          OR: [
            { organizationId },
            ...(agentIds.length > 0
              ? [{ agentId: { in: agentIds } }]
              : []),
            ...(userIds.length > 0
              ? [{ actorUserId: { in: userIds } }]
              : []),
          ],
        },
      })
    ).count;
    // Audit rows carry a mix of scopes: organizationId (set going forward),
    // agentId (agent events), or just userId (older rows / user events). Match
    // any of them so nothing for this org is left behind. The organizationId
    // clause is unconditional; agent/user clauses are added when non-empty.
    // Runs BEFORE the PRIVACY_ORG_ERASED proof record is written below, so that
    // record survives as the deliberate proof-of-erasure row.
    result.auditLogs = (
      await this.prisma.auditLog.deleteMany({
        where: {
          OR: [
            { organizationId },
            ...(agentIds.length > 0 ? [{ agentId: { in: agentIds } }] : []),
            ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
          ],
        },
      })
    ).count;

    // 2) Conversations. One statement; FK cascade removes chat_messages,
    //    chat_message_metrics and collected_data.
    if (agentIds.length > 0) {
      result.sessions = (
        await this.prisma.chatSession.deleteMany({
          where: { agentId: { in: agentIds } },
        })
      ).count;
    }

    // 3) Files: best-effort storage cleanup first (warns, never throws),
    //    then the rows.
    const files = await this.prisma.file.findMany({
      where: { organizationId },
      select: { bucket: true, storageKey: true },
    });
    const byBucket = new Map<string, string[]>();
    for (const f of files) {
      const keys = byBucket.get(f.bucket) ?? [];
      keys.push(f.storageKey);
      byBucket.set(f.bucket, keys);
    }
    for (const [bucket, keys] of byBucket) {
      await this.storage.remove(bucket, keys);
    }
    result.files = (
      await this.prisma.file.deleteMany({ where: { organizationId } })
    ).count;

    // 4) Agents (hard). Sessions are gone, so the Restrict FK is satisfied;
    //    secrets/theme/knowledge/data-fields/whatsapp cascade from the agent.
    if (agentIds.length > 0) {
      await this.prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    }

    // 5) People, invitations, then the org row itself.
    result.invitations = (
      await this.prisma.userInvitation.deleteMany({ where: { organizationId } })
    ).count;
    if (userIds.length > 0) {
      await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await this.prisma.organization.delete({ where: { id: organizationId } });

    this.log.info(
      'eraseOrganization',
      `hard-deleted org=${organizationId}: agents=${result.agents} users=${result.users} sessions=${result.sessions} traces=${result.chatTraces} eventLogs=${result.eventLogs} files=${result.files}`,
    );
    // Written AFTER the org's audit rows were purged — this single surviving
    // row is the deliberate proof-of-erasure record. (A re-run throws NotFound
    // at the top since the org is gone, so this row is never re-deleted.)
    await this.tracer.logAuditEvent(
      organizationId,
      'PRIVACY_ORG_ERASED',
      {
        agents: result.agents,
        users: result.users,
        sessions: result.sessions,
        piiTokens: result.piiTokens,
        chatTraces: result.chatTraces,
        llmUsage: result.llmUsage,
        eventLogs: result.eventLogs,
        auditLogs: result.auditLogs,
        files: result.files,
        invitations: result.invitations,
      },
      { organizationId },
    );

    return result;
  }
}
