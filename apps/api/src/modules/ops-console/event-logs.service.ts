import { Injectable, NotFoundException } from "@nestjs/common";
import type { EventChannel, EventDirection, Prisma } from "@prisma/client";
import type { EventLogListQuery } from "@repo/validation";
import { PrismaService } from "../../services/prisma.service";
import {
  isSensitiveKey,
  redact,
  sanitizeHeaders,
} from "../../common/events/redaction.util";
import {
  COUNT_CAP,
  HOUR_MS,
  pageMeta,
  pageWindow,
  resolveWindow,
  scrubUrl,
  truncate,
  uniqueIds,
  type PageMeta,
} from "./ops-console.util";

const DEFAULT_WINDOW_MS = 24 * HOUR_MS;
const MAX_WINDOW_DAYS = 30;
/** The list shows a one-line error; the detail shows it in full. */
const LIST_ERROR_CHARS = 300;

export interface EventLogListRow {
  id: string;
  createdAt: Date;
  channel: EventChannel;
  eventName: string;
  direction: EventDirection;
  provider: string | null;
  actorUserId: string | null;
  agentId: string | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  sessionId: string | null;
  correlationId: string | null;
  requestUrl: string | null;
  responseStatus: number | null;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface EventLogPage {
  data: EventLogListRow[];
  meta: PageMeta & { from: string; to: string };
}

export interface EventLogDetail extends Omit<EventLogListRow, "organization"> {
  organization: { id: string; name: string } | null;
  actor: { id: string; email: string; name: string | null } | null;
  visitorId: string | null;
  requestHeaders: Record<string, string> | null;
  requestPayload: unknown;
  responsePayload: unknown;
  metadata: unknown;
}

const LIST_SELECT = {
  id: true,
  createdAt: true,
  channel: true,
  eventName: true,
  direction: true,
  provider: true,
  actorUserId: true,
  agentId: true,
  organizationId: true,
  sessionId: true,
  correlationId: true,
  requestUrl: true,
  responseStatus: true,
  latencyMs: true,
  success: true,
  errorMessage: true,
} satisfies Prisma.EventLogSelect;

/**
 * Read side of `event_logs` for the platform ops console. List rows are slim
 * (no payloads); the payloads come one row at a time from `get()`.
 *
 * Writes are already redacted (redaction.util). Reads run the same scrubbers
 * again, so a header or key that predates a writer fix, or slipped past it,
 * is still stripped before it leaves the API.
 */
@Injectable()
export class EventLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: EventLogListQuery): Promise<EventLogPage> {
    const { from, to } = resolveWindow(q, DEFAULT_WINDOW_MS, MAX_WINDOW_DAYS);
    const { skip, take } = pageWindow(q.page, q.limit);

    const and: Prisma.EventLogWhereInput[] = [
      { createdAt: { gte: from, lte: to } },
    ];
    if (q.channels?.length) and.push({ channel: { in: q.channels } });
    if (q.providers?.length) and.push({ provider: { in: q.providers } });
    if (q.eventName) and.push({ eventName: q.eventName });
    if (q.success !== undefined) and.push({ success: q.success });
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    if (q.agentId) and.push({ agentId: q.agentId });
    if (q.sessionId) and.push({ sessionId: q.sessionId });
    if (q.search) {
      // Paste a session or correlation id, or type part of an event name.
      and.push({
        OR: [
          { eventName: { contains: q.search, mode: "insensitive" } },
          { sessionId: q.search },
          { correlationId: q.search },
        ],
      });
    }
    const where: Prisma.EventLogWhereInput = { AND: and };

    const [rows, cappedCount] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        orderBy: [{ createdAt: q.sortOrder }, { id: q.sortOrder }],
        skip,
        take,
        select: LIST_SELECT,
      }),
      this.prisma.eventLog.count({ where, take: COUNT_CAP + 1 }),
    ]);

    const orgIds = uniqueIds(rows.map((r) => r.organizationId));
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    return {
      data: rows.map((r) => ({
        ...r,
        organization:
          (r.organizationId && orgById.get(r.organizationId)) || null,
        requestUrl: scrubUrl(r.requestUrl),
        errorMessage: truncate(r.errorMessage, LIST_ERROR_CHARS),
      })),
      meta: {
        ...pageMeta(q.page, q.limit, cappedCount),
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }

  async get(id: string): Promise<EventLogDetail> {
    const row = await this.prisma.eventLog.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        visitorId: true,
        requestHeaders: true,
        requestPayload: true,
        responsePayload: true,
        metadata: true,
      },
    });
    if (!row) throw new NotFoundException("Event log not found");

    const [organization, actor] = await Promise.all([
      row.organizationId
        ? this.prisma.organization.findUnique({
            where: { id: row.organizationId },
            select: { id: true, name: true },
          })
        : null,
      row.actorUserId
        ? this.prisma.user.findUnique({
            where: { id: row.actorUserId },
            select: { id: true, email: true, name: true },
          })
        : null,
    ]);

    return {
      ...row,
      organization,
      actor,
      requestUrl: scrubUrl(row.requestUrl),
      requestHeaders: stripHeaders(row.requestHeaders),
      requestPayload: redact(row.requestPayload),
      responsePayload: redact(row.responsePayload),
      metadata: redact(row.metadata),
    };
  }
}

/**
 * Headers are stored as a flat object. Anything else (a legacy array, a
 * string) is dropped rather than guessed at. Authorization, cookies, API keys
 * and the internal cron secret never survive `sanitizeHeaders`.
 */
export function stripHeaders(
  value: Prisma.JsonValue | null,
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const known = sanitizeHeaders(value as Record<string, unknown>);
  if (!known) return null;
  // Also drop custom names that look like credentials (x-webhook-secret,
  // x-session-token, ...), which the fixed header list cannot anticipate.
  const kept = Object.entries(known).filter(([k]) => !isSensitiveKey(k));
  return kept.length ? Object.fromEntries(kept) : null;
}
