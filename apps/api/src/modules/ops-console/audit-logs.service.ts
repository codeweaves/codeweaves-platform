import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuditLogListQuery } from "@repo/validation";
import { PrismaService } from "../../services/prisma.service";
import { redact } from "../../common/events/redaction.util";
import {
  COUNT_CAP,
  daysMs,
  pageMeta,
  pageWindow,
  resolveWindow,
  uniqueIds,
  type PageMeta,
} from "./ops-console.util";

/** Default window when the caller gives no `from`. */
const DEFAULT_WINDOW_MS = daysMs(7);
const MAX_WINDOW_DAYS = 90;
/** Window for the event-name filter options. */
const EVENT_NAMES_WINDOW_MS = daysMs(30);

export interface AuditLogRow {
  id: string;
  createdAt: Date;
  event: string;
  contextId: string;
  correlationId: string | null;
  userId: string | null;
  user: { id: string; email: string; name: string | null } | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  agentId: string | null;
  agent: { id: string; name: string } | null;
  data: unknown;
}

export interface AuditLogPage {
  data: AuditLogRow[];
  meta: PageMeta & { from: string; to: string };
}

/**
 * Read side of `audit_logs` for the platform ops console. Rows are PII-masked
 * at write time; `data` is re-run through the redactor on the way out so a key
 * that slipped past the writer still never reaches the browser.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: AuditLogListQuery): Promise<AuditLogPage> {
    const { from, to } = resolveWindow(q, DEFAULT_WINDOW_MS, MAX_WINDOW_DAYS);
    const { skip, take } = pageWindow(q.page, q.limit);

    const and: Prisma.AuditLogWhereInput[] = [
      { createdAt: { gte: from, lte: to } },
    ];
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    if (q.userId) and.push({ userId: q.userId });
    if (q.agentId) and.push({ agentId: q.agentId });
    if (q.events?.length) and.push({ event: { in: q.events } });
    if (q.search) {
      and.push({ event: { contains: q.search, mode: "insensitive" } });
    }
    const where: Prisma.AuditLogWhereInput = { AND: and };

    const [rows, cappedCount] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: q.sortOrder }, { id: q.sortOrder }],
        skip,
        take,
        select: {
          id: true,
          createdAt: true,
          event: true,
          contextId: true,
          correlationId: true,
          userId: true,
          organizationId: true,
          agentId: true,
          data: true,
        },
      }),
      // Bounded count: stops at COUNT_CAP + 1 rows (see COUNT_CAP).
      this.prisma.auditLog.count({ where, take: COUNT_CAP + 1 }),
    ]);

    // audit_logs has no foreign keys (a row must outlive what it names), so
    // display names come from one batched lookup per table, in parallel.
    const userIds = uniqueIds(rows.map((r) => r.userId));
    const orgIds = uniqueIds(rows.map((r) => r.organizationId));
    const agentIds = uniqueIds(rows.map((r) => r.agentId));
    const [users, orgs, agents] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
          })
        : [],
      orgIds.length
        ? this.prisma.organization.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : [],
      agentIds.length
        ? this.prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    const agentById = new Map(agents.map((a) => [a.id, a]));

    return {
      data: rows.map((r) => ({
        ...r,
        user: (r.userId && userById.get(r.userId)) || null,
        organization:
          (r.organizationId && orgById.get(r.organizationId)) || null,
        agent: (r.agentId && agentById.get(r.agentId)) || null,
        data: redact(r.data),
      })),
      meta: {
        ...pageMeta(q.page, q.limit, cappedCount),
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }

  /** Distinct event names seen in the last 30 days, for the filter dropdown. */
  async eventNames(): Promise<{ events: string[] }> {
    const groups = await this.prisma.auditLog.groupBy({
      by: ["event"],
      where: {
        createdAt: { gte: new Date(Date.now() - EVENT_NAMES_WINDOW_MS) },
      },
      orderBy: { event: "asc" },
      take: 500,
    });
    return { events: groups.map((g) => g.event) };
  }
}
