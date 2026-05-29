import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import type { ConversationsListQuery } from '../models/conversations.dto';

/**
 * Conversations service — powers the dashboard "Conversations" page.
 *
 * List endpoint: paginated chat sessions with message-count rollups, agent
 * name, and visitor id. Filters: agent, org (admin-only), source, status,
 * visitor, date range, and free-text search (matches session title, summary,
 * or message content).
 *
 * Detail endpoint: full transcript for a single session, including any
 * ChatTrace rows so the UI can show per-turn execution steps (model used,
 * tool calls, timing). Tenant scoping mirrors AnalyticsService — CLIENTs see
 * only their own org; ADMINs see all unless filtered by orgId.
 *
 * Soft-deleted agents are excluded for ALL roles (including SUPER_ADMIN
 * unrestricted): a removed bot's transcripts shouldn't show up under
 * "active" conversations. We enforce this via a Prisma to-one relation
 * filter on the agent — single SQL join, no separate agent.findMany pass.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the `agent` relation filter for a ChatSession `where`. Combines
   *   1. soft-delete exclusion (always),
   *   2. tenant scoping (CLIENT → own org; ADMIN → orgId if supplied), and
   *   3. agentId narrowing (single or comma-separated list).
   *
   * The filter is applied as a single Prisma relation filter so Postgres
   * can use the indexed FK join instead of round-tripping through agent.findMany.
   */
  private buildAgentScopeFilter(
    query: { agentId?: string; agentIds?: string[]; orgId?: string },
    user: CurrentUserData,
  ): { agent: Prisma.AgentWhereInput; agentId?: Prisma.StringFilter } {
    if (user.role === Role.CLIENT && !user.organizationId) {
      throw new ForbiddenException('Client user must be associated with an organization');
    }

    const agentIdList = [
      ...(query.agentId ? [query.agentId] : []),
      ...(query.agentIds ?? []),
    ];

    const agent: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      ...(user.role !== Role.CLIENT && query.orgId && { organizationId: query.orgId }),
    };

    return {
      agent,
      ...(agentIdList.length > 0 && { agentId: { in: agentIdList } }),
    };
  }

  async list(query: ConversationsListQuery, user: CurrentUserData) {
    const { page, limit, sortBy, sortOrder } = query;

    const scope = this.buildAgentScopeFilter(query, user);

    const where: Prisma.ChatSessionWhereInput = {
      ...scope,
      ...(query.source && { source: query.source }),
      ...(query.sources && query.sources.length > 0 && { source: { in: query.sources } }),
      ...(query.status && { status: query.status }),
      ...(query.statuses && query.statuses.length > 0 && { status: { in: query.statuses } }),
      ...(query.categories && query.categories.length > 0 && { category: { in: query.categories } }),
      ...(query.visitorId && { visitorId: { contains: query.visitorId, mode: 'insensitive' } }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { summary: { contains: query.search, mode: 'insensitive' } },
          { messages: { some: { content: { contains: query.search, mode: 'insensitive' } } } },
        ],
      }),
    };

    // messageCount sort is not a column on ChatSession — Prisma supports it
    // via `_count` orderBy on the relation, which compiles to a correlated
    // subquery. lastMessageAt is nullable (a session has none until its first
    // assistant reply lands, and aborted streams never write it) — push nulls
    // to the end so brand-new/errored sessions don't float above real activity.
    const orderBy: Prisma.ChatSessionOrderByWithRelationInput =
      sortBy === 'messageCount'
        ? { messages: { _count: sortOrder } }
        : sortBy === 'lastMessageAt'
          ? { lastMessageAt: { sort: sortOrder, nulls: 'last' } }
          : { [sortBy]: sortOrder };

    const [rows, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sessionId: true,
          agentId: true,
          source: true,
          visitorId: true,
          status: true,
          title: true,
          category: true,
          detectedLanguage: true,
          createdAt: true,
          lastMessageAt: true,
          agent: { select: { id: true, name: true, organizationId: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        agent: { id: r.agent.id, name: r.agent.name },
        organizationId: r.agent.organizationId,
        source: r.source,
        status: r.status,
        visitorId: r.visitorId,
        title: r.title,
        category: r.category,
        detectedLanguage: r.detectedLanguage,
        messageCount: r._count.messages,
        createdAt: r.createdAt.toISOString(),
        lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
        // Display-friendly fallback: when no assistant reply has updated
        // lastMessageAt yet, surface createdAt so the UI shows "5m ago"
        // instead of "—" for a session that clearly just happened.
        lastActivityAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBySessionId(sessionId: string, user: CurrentUserData) {
    // sessionId on ChatSession is the public-facing unique identifier the
    // widget/demo uses. Resolve via findFirst so we can layer tenant scope +
    // soft-delete exclusion onto the agent relation in a single query — a
    // CLIENT looking at someone else's session, or anyone looking at a session
    // for a soft-deleted agent, gets a clean 404 instead of leaking existence.
    const scope = this.buildAgentScopeFilter({}, user);
    const session = await this.prisma.chatSession.findFirst({
      where: { sessionId, ...scope },
      select: {
        id: true,
        sessionId: true,
        source: true,
        visitorId: true,
        status: true,
        title: true,
        summary: true,
        category: true,
        detectedLanguage: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
        agent: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Conversation not found');
    }

    // ChatTrace is keyed by ChatSession.sessionId (string). Load all traces
    // for this session so the UI can correlate them with assistant messages
    // via traces[i].messageId === messages[j].id.
    const traces = await this.prisma.chatTrace.findMany({
      where: { sessionId: session.sessionId },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        traceId: true,
        messageId: true,
        model: true,
        steps: true,
        startedAt: true,
        completedAt: true,
        totalDurationMs: true,
        success: true,
        errorMessage: true,
      },
    });

    return {
      id: session.id,
      sessionId: session.sessionId,
      source: session.source,
      status: session.status,
      visitorId: session.visitorId,
      title: session.title,
      summary: session.summary,
      category: session.category,
      detectedLanguage: session.detectedLanguage,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      lastMessageAt: session.lastMessageAt ? session.lastMessageAt.toISOString() : null,
      agent: {
        id: session.agent.id,
        name: session.agent.name,
        organization: session.agent.organization,
      },
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt.toISOString(),
      })),
      traces: traces.map((t) => ({
        id: t.id,
        traceId: t.traceId,
        messageId: t.messageId,
        model: t.model,
        steps: t.steps,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        totalDurationMs: t.totalDurationMs,
        success: t.success,
        errorMessage: t.errorMessage,
      })),
    };
  }
}
