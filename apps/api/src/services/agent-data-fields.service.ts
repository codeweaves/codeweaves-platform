import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AgentDataField } from '@prisma/client';
import { type UpdateDataFieldsDto } from '@repo/validation';

import { AgentCacheService } from '../common/cache/agent-cache.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AppLogger } from '../common/logger/app-logger';
import { TracerService } from '../common/tracer/tracer.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';

import { PrismaService } from './prisma.service';
import { isOrgScoped } from '../utils/tenant-filter';
import { CSV_BOM, csvFilenameSegment, csvRow } from '../utils/csv';
import { createTimestampFormatter, resolveTimeZone } from '../utils/datetime';

/** A column in the collected-data table: the JSON key plus its display label. */
interface CollectedDataColumn {
  key: string;
  label: string;
}

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
  private readonly log = new AppLogger(AgentDataFieldsService.name);

  private static readonly COLLECTED_DATA_DEFAULT_LIMIT = 20;
  private static readonly COLLECTED_DATA_MAX_LIMIT = 100;

  /**
   * CSV export tuning. Rows are read in cursor-paged batches and streamed out,
   * so neither the API nor Postgres ever holds the whole export in memory. The
   * hard row cap stops one enormous tenant from pinning a worker for minutes;
   * it is announced in the file itself and in the audit log when hit.
   */
  private static readonly EXPORT_BATCH_SIZE = 500;
  private static readonly EXPORT_MAX_ROWS = 50_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentCache: AgentCacheService,
    private readonly crypto: CryptoService,
    private readonly tracer: TracerService,
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
    const { organizationId } = await this.assertAgentAccess(agentId, user);

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
    this.log.info('replaceAll', 'data-capture fields replaced', {
      agentId,
      fieldCount: fields.length,
    });
    // Accountability: defines what PII the bot captures from visitors — a
    // data-governance change. Store keys/labels/types only, never captured values.
    await this.tracer.logAuditEvent(
      agentId,
      'AGENT_DATA_FIELDS_UPDATED',
      {
        response: {
          fieldCount: fields.length,
          keys: fields.map((f) => f.key),
          userId: user.id,
        },
      },
      { organizationId, agentId },
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

    const columns = await this.buildColumns(agentId);

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

    // Stored values are encrypted at rest (S1); decrypt for display. Keys are
    // plaintext (the column derivation above depends on that), legacy
    // plaintext rows pass through unchanged.
    const decryptedRows = rows.map((row) => ({
      ...row,
      data: this.crypto.decryptFieldValues(
        row.data as Record<string, unknown> | null,
      ),
    }));

    return { columns, rows: decryptedRows, total, page: safePage, limit: safeLimit };
  }

  /**
   * Authorise a CSV export and hand back a lazy stream of the file.
   *
   * Split in two deliberately: everything that can FAIL (access check, column
   * derivation) happens here and throws before the controller has written a
   * single response header, so a 404 still renders as JSON rather than as a
   * corrupt half-download. Only the row streaming is deferred.
   *
   * The export covers EVERY row, never the page on screen — the dashboard's
   * pagination is a viewport, not a filter. Sort order carries across because
   * that IS a choice the user made about the data.
   *
   * `timeZone` is the browser's IANA zone; timestamps render in it rather than
   * UTC so the file reads the way the dashboard does.
   */
  async prepareCollectedDataExport(
    agentId: string,
    user: CurrentUserData,
    sortOrder: 'asc' | 'desc' = 'desc',
    timeZone?: string,
  ): Promise<{ filename: string; stream: AsyncGenerator<string> }> {
    const agent = await this.assertAgentAccess(agentId, user);
    const columns = await this.buildColumns(agentId);
    const zone = resolveTimeZone(timeZone);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `collected-data-${csvFilenameSegment(agent.name, 'agent')}-${date}.csv`;

    return {
      filename,
      stream: this.streamCollectedDataCsv(
        agentId,
        agent.organizationId,
        columns,
        sortOrder,
        zone,
        user,
      ),
    };
  }

  /**
   * Cursor-paged CSV generator: one batch in flight at a time, decrypted and
   * serialised as it goes.
   *
   * Cursor rather than offset paging because `skip` makes Postgres re-scan and
   * discard every earlier row, so a deep page of a large export costs
   * quadratic work. `id` is the tiebreaker on `extractedAt` (which is not
   * unique) to keep the ordering total and the cursor stable.
   */
  private async *streamCollectedDataCsv(
    agentId: string,
    organizationId: string,
    columns: CollectedDataColumn[],
    sortOrder: 'asc' | 'desc',
    timeZone: string,
    user: CurrentUserData,
  ): AsyncGenerator<string> {
    const formatTimestamp = createTimestampFormatter(timeZone);
    let cursor: string | undefined;
    let rowCount = 0;
    let truncated = false;

    // Everything, header included, sits inside the try: a client that aborts
    // after receiving only the header still gets an audit entry.
    try {
      // BOM first, then the header. The zone is named in the header so the file
      // is self-describing once it has been mailed on to someone else.
      yield CSV_BOM +
        csvRow([...columns.map((c) => c.label), `Captured At (${timeZone})`]);

      for (;;) {
        const batch = await this.prisma.collectedData.findMany({
          where: { agentId },
          orderBy: [{ extractedAt: sortOrder }, { id: 'asc' }],
          take: AgentDataFieldsService.EXPORT_BATCH_SIZE,
          ...(cursor && { cursor: { id: cursor }, skip: 1 }),
          select: {
            id: true,
            data: true,
            extractedAt: true,
          },
        });
        if (batch.length === 0) break;

        let chunk = '';
        for (const row of batch) {
          const values = this.crypto.decryptFieldValues(
            row.data as Record<string, unknown> | null,
          );
          chunk += csvRow([
            ...columns.map((c) => values[c.key]),
            formatTimestamp(row.extractedAt),
          ]);
          rowCount += 1;
          if (rowCount >= AgentDataFieldsService.EXPORT_MAX_ROWS) {
            truncated = true;
            break;
          }
        }
        yield chunk;

        if (truncated) {
          yield csvRow([
            `Export truncated at ${AgentDataFieldsService.EXPORT_MAX_ROWS} rows. Narrow the range or contact support for the full set.`,
          ]);
          break;
        }
        if (batch.length < AgentDataFieldsService.EXPORT_BATCH_SIZE) break;
        cursor = batch[batch.length - 1]!.id;
      }
    } finally {
      // Bulk PII leaving the platform is exactly what an auditor asks about, so
      // this is written even when the client aborts mid-download (the generator's
      // `finally` runs on early return) — a partial export still left the building.
      // Never throws: the file has already been delivered by this point.
      try {
        await this.tracer.logAuditEvent(
          agentId,
          'COLLECTED_DATA_EXPORTED',
          {
            response: {
              rowCount,
              truncated,
              sortOrder,
              timeZone,
              columnKeys: columns.map((c) => c.key),
              userId: user.id,
            },
          },
          { organizationId, agentId },
        );
      } catch (error) {
        this.log.warn('streamCollectedDataCsv', 'export audit log failed', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.log.info('streamCollectedDataCsv', 'collected-data CSV exported', {
        agentId,
        rowCount,
        truncated,
      });
    }
  }

  /**
   * The dynamic column set for an agent, shared by the table view and the CSV
   * export so both always show the same shape.
   *
   * Current field defs come first (labelled, ordered, present even with no data
   * yet), then any orphaned keys still sitting in stored rows — e.g. from a
   * renamed field — surfaced under their raw key so nothing is silently hidden.
   * The result is sorted by label so the table reads predictably regardless of
   * field-definition order.
   */
  private async buildColumns(agentId: string): Promise<CollectedDataColumn[]> {
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

    const columns: CollectedDataColumn[] = [];
    const seen = new Set<string>();
    for (const field of fields) {
      columns.push({ key: field.key, label: field.label });
      seen.add(field.key);
    }
    for (const key of presentKeys) {
      if (!seen.has(key)) columns.push({ key, label: key });
    }
    columns.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
    return columns;
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
  ): Promise<{ id: string; organizationId: string; name: string }> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(isOrgScoped(user) && {
          organizationId: user.organizationId!,
        }),
      },
      select: { id: true, organizationId: true, name: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
    return agent;
  }
}
