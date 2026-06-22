import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role, type AgentDataField } from '@prisma/client';
import { type UpdateDataFieldsDto } from '@repo/validation';

import { AgentCacheService } from '../common/cache/agent-cache.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';

import { PrismaService } from './prisma.service';

/**
 * AgentDataFieldsService: CRUD for an agent's "data capture" field definitions
 * (what the bot should collect from a conversation) plus read access to the
 * values that were captured (`CollectedData`).
 *
 * Field definitions ride the agent cache (read on the chat hot path to build
 * the collection prompt), so writes here bust that cache.
 *
 * NOT responsible for:
 *   - Extracting values from conversations — that's the background extractor
 *     (data-extractor queue), off the reply hot path.
 *   - Injecting the field list into the system prompt — DirectChatService does
 *     that from the cached agent.
 *
 * Multi-tenant isolation: `CollectedData` holds PII (emails, phones), so every
 * method goes through `assertAgentAccess`, which scopes CLIENT users to their
 * own organisation (ADMIN/SUPER_ADMIN are platform staff, cross-org). This
 * mirrors AgentsService.findByIdRaw — do NOT relax it.
 */
@Injectable()
export class AgentDataFieldsService {
  private readonly logger = new Logger(AgentDataFieldsService.name);

  private static readonly COLLECTED_DATA_DEFAULT_LIMIT = 20;
  private static readonly COLLECTED_DATA_MAX_LIMIT = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentCache: AgentCacheService,
  ) {}

  /** List an agent's field definitions, in display order. */
  async list(
    agentId: string,
    user: CurrentUserData,
  ): Promise<AgentDataField[]> {
    await this.assertAgentAccess(agentId, user);
    return this.prisma.agentDataField.findMany({
      where: { agentId },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Replace the agent's ENTIRE field list (the editor sends the whole list,
   * like conversation starters). Order is taken from array position. Done in a
   * single transaction (wipe + recreate).
   *
   * Replacing definitions never corrupts historical data: `CollectedData.data`
   * is keyed by the field `key` (a string), so values under removed/renamed
   * keys simply become orphaned in old rows — harmless, and the dashboard only
   * surfaces values whose key still has a definition.
   */
  async replaceAll(
    agentId: string,
    dto: UpdateDataFieldsDto,
    user: CurrentUserData,
  ): Promise<AgentDataField[]> {
    await this.assertAgentAccess(agentId, user);

    const fields = await this.prisma.$transaction(async (tx) => {
      await tx.agentDataField.deleteMany({ where: { agentId } });
      if (dto.fields.length > 0) {
        await tx.agentDataField.createMany({
          data: dto.fields.map((field, index) => ({
            agentId,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            description: field.description ?? null,
            order: index,
          })),
        });
      }
      return tx.agentDataField.findMany({
        where: { agentId },
        orderBy: { order: 'asc' },
      });
    });

    // Field defs are read on the chat hot path (collection prompt), so bust the
    // agent cache after the write.
    await this.agentCache.invalidate(agentId);
    this.logger.log(
      `Replaced data-capture fields for agent ${agentId}: ${fields.length} field(s).`,
    );
    return fields;
  }

  /**
   * Paginated "collected data" view for the dashboard. Returns the dynamic
   * column set (current field defs first — labelled + ordered, shown even with
   * no data yet — then any orphaned keys still present in stored rows, e.g. from
   * a renamed field), one page of rows (one per conversation), and the total.
   *
   * Org-scoped via assertAgentAccess: CLIENT users only reach their own agents,
   * ADMIN/SUPER_ADMIN any. This is the one read clients are allowed (defining
   * fields stays admin-only).
   */
  async getCollectedDataView(
    agentId: string,
    user: CurrentUserData,
    page = 1,
    limit = AgentDataFieldsService.COLLECTED_DATA_DEFAULT_LIMIT,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<{
    columns: Array<{ key: string; label: string }>;
    rows: Array<{ chatSessionId: string; data: unknown; extractedAt: Date }>;
    total: number;
    page: number;
    limit: number;
  }> {
    await this.assertAgentAccess(agentId, user);

    const safeLimit = Math.min(
      Math.max(limit, 1),
      AgentDataFieldsService.COLLECTED_DATA_MAX_LIMIT,
    );
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    // Distinct keys across ALL captured rows → stable columns across pages.
    // (agentId column is Postgres `text`, so a plain text param compares fine.)
    const keyRows = await this.prisma.$queryRaw<Array<{ key: string }>>`
      SELECT DISTINCT jsonb_object_keys(data) AS key
      FROM collected_data
      WHERE "agentId" = ${agentId}
    `;
    const presentKeys = new Set(keyRows.map((r) => r.key));

    const fields = await this.prisma.agentDataField.findMany({
      where: { agentId },
      orderBy: { order: 'asc' },
      select: { key: true, label: true },
    });

    const columns: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    // Current fields — friendly labels, shown even if no data has been captured
    // for them yet (stable table structure).
    for (const field of fields) {
      columns.push({ key: field.key, label: field.label });
      seen.add(field.key);
    }
    // Orphaned keys: present in stored data but no current field def (e.g. a
    // renamed field). Surfaced with the raw key so nothing is silently hidden.
    for (const key of presentKeys) {
      if (!seen.has(key)) columns.push({ key, label: key });
    }
    // Order columns alphabetically by header label (case-insensitive) so the
    // table reads predictably regardless of field-definition order. (The
    // "Captured at" column is appended client-side and always stays last.)
    columns.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );

    const [rows, total] = await Promise.all([
      this.prisma.collectedData.findMany({
        where: { agentId },
        orderBy: { extractedAt: sortOrder },
        skip,
        take: safeLimit,
        select: { chatSessionId: true, data: true, extractedAt: true },
      }),
      this.prisma.collectedData.count({ where: { agentId } }),
    ]);

    return { columns, rows, total, page: safePage, limit: safeLimit };
  }

  /**
   * Verify the agent exists and the caller may access it. CLIENT users are
   * scoped to their own organisation; ADMIN/SUPER_ADMIN (platform staff) may
   * reach any org. Throws 404 (not 403) on a miss so we don't leak which agent
   * IDs exist across tenants.
   */
  private async assertAgentAccess(
    agentId: string,
    user: CurrentUserData,
  ): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(user.role === Role.CLIENT && {
          organizationId: user.organizationId!,
        }),
      },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
  }
}
