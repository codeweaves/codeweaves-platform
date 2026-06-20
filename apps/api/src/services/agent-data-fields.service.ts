import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role, type AgentDataField, type CollectedData } from '@prisma/client';
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

  private static readonly COLLECTED_DATA_DEFAULT_LIMIT = 100;
  private static readonly COLLECTED_DATA_MAX_LIMIT = 500;

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
   * List captured data for an agent's conversations, most-recent first. Backs
   * the dashboard "collected data" view. Bounded; cursor pagination can be
   * layered on later (see analytics for the pattern).
   */
  async listCollectedData(
    agentId: string,
    user: CurrentUserData,
    limit?: number,
  ): Promise<CollectedData[]> {
    await this.assertAgentAccess(agentId, user);
    const take = Math.min(
      Math.max(
        limit ?? AgentDataFieldsService.COLLECTED_DATA_DEFAULT_LIMIT,
        1,
      ),
      AgentDataFieldsService.COLLECTED_DATA_MAX_LIMIT,
    );
    return this.prisma.collectedData.findMany({
      where: { agentId },
      orderBy: { extractedAt: 'desc' },
      take,
    });
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
