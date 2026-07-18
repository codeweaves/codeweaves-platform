import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { Prisma, Role, Agent } from '@prisma/client';
import {
  agentAiConfigUpdateSchema,
  voiceConfigSchema,
} from '@repo/validation';
import { ZodError } from 'zod';
import type { CreateAgentDto, UpdateAgentDto, AgentListQuery } from '../models/agent.dto';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { generatePublicId } from '../utils/public-id';
import { deduplicateDomains, isValidDomain } from '../utils/domain';
import { AgentLoggerService } from '../common/logger/agent.logger';
import { AgentCacheService } from '../common/cache/agent-cache.service';
import { WidgetCorsCacheService } from '../common/cache/widget-cors-cache.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AppLogger } from '../common/logger/app-logger';

const MAX_PUBLIC_ID_RETRIES = 3;
const WEBHOOK_TEST_TIMEOUT = 10_000;

/**
 * Dedupes a list of category keywords case-insensitively while preserving the
 * casing of the FIRST occurrence. Whitespace-only entries are dropped — Zod
 * already trims them but defending against future schema drift is cheap.
 */
function dedupeCategoryKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

@Injectable()
export class AgentsService {
  private readonly log = new AppLogger(AgentsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly agentCache: AgentCacheService,
    private readonly widgetCorsCache: WidgetCorsCacheService,
  ) {}

  async create(dto: CreateAgentDto, user: CurrentUserData) {
    this.log.debug('create', 'creating agent', { organizationId: dto.organizationId });
    const org = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    for (let attempt = 0; attempt < MAX_PUBLIC_ID_RETRIES; attempt++) {
      const publicId = generatePublicId();

      try {
        const agent = await this.prisma.agent.create({
          data: {
            publicId,
            name: dto.name,
            organizationId: dto.organizationId,
          },
        });
        await this.agentLogger.logAgentCreated(agent.id, { agent, request: dto, userId: user.id });
        this.log.info('create', 'agent created', { agentId: agent.id, organizationId: dto.organizationId });
        return agent;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          Array.isArray(error.meta?.['target']) &&
          (error.meta['target'] as string[]).includes('publicId')
        ) {
          this.log.warn('create', `publicId collision, retrying (attempt ${attempt + 1}/${MAX_PUBLIC_ID_RETRIES})`);
          if (attempt === MAX_PUBLIC_ID_RETRIES - 1) {
            throw new ConflictException('Unable to generate a unique public ID. Please try again.');
          }
          continue;
        }
        this.log.error('create', 'agent creation failed', error, { organizationId: dto.organizationId });
        await this.agentLogger.logAgentCreationException(
          dto.organizationId,
          error,
          { request: dto, userId: user.id },
        );
        throw error;
      }
    }

    throw new ConflictException('Unable to generate a unique public ID. Please try again.');
  }

  async findAll(
    query: AgentListQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
    user: CurrentUserData,
  ) {
    const { page, limit, search, sortBy, sortOrder, status, organizationId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      ...(user.role !== Role.CLIENT && organizationId && { organizationId }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
      ...(status && { status }),
    };

    const orderBy: Prisma.AgentOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { organization: { select: { id: true, name: true } } },
      }),
      this.prisma.agent.count({ where }),
    ]);

    return {
      data: data.map((agent) => this.stripSensitiveFields(agent, user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return this.stripSensitiveFields(agent, user);
  }

  async update(id: string, dto: UpdateAgentDto, user: CurrentUserData) {
    this.log.debug('update', 'updating agent', { agentId: id, fields: Object.keys(dto) });
    const existing = await this.findByIdRaw(id, user);

    // Validate, normalize, and deduplicate domains before saving
    if (dto.allowedDomains !== undefined) {
      const invalidDomains = dto.allowedDomains.filter((d) => !isValidDomain(d));
      if (invalidDomains.length > 0) {
        throw new BadRequestException(
          `Invalid domain(s): ${invalidDomains.join(', ')}`,
        );
      }
    }
    const normalizedDomains =
      dto.allowedDomains !== undefined
        ? deduplicateDomains(dto.allowedDomains)
        : undefined;

    // Validate voiceConfig with Zod before writing to DB
    let voiceConfigData: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (dto.voiceConfig !== undefined) {
      if (dto.voiceConfig === null) {
        voiceConfigData = Prisma.DbNull;
      } else {
        try {
          const parsed = voiceConfigSchema.parse(dto.voiceConfig);
          // Zod output is plain JS object with JSON-safe primitives (booleans, strings, numbers)
          voiceConfigData = parsed as Prisma.InputJsonValue;
        } catch (error) {
          if (error instanceof ZodError) {
            throw new BadRequestException(
              `Invalid voice configuration: ${error.errors.map((e) => e.message).join(', ')}`,
            );
          }
          throw error;
        }
      }
    }

    // Prevent enabling voice without a voiceConfig present
    if (dto.voiceEnabled === true && voiceConfigData === undefined) {
      // Check if the existing agent already has a voiceConfig
      if (!existing.voiceConfig) {
        throw new BadRequestException(
          'Cannot enable voice without a voice configuration. Provide voiceConfig in the same request.',
        );
      }
    }

    // Validate aiConfig (Phase 1: AI orchestration layer). Stored as JSONB,
    // null clears the override (agent falls back to n8n routing by default).
    // Merge with existing config so partial PATCH updates don't blow away other fields.
    let aiConfigData: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (dto.aiConfig !== undefined) {
      if (dto.aiConfig === null) {
        aiConfigData = Prisma.DbNull;
      } else {
        try {
          const existingAiConfig =
            (existing.aiConfig as Record<string, unknown> | null) ?? {};
          const merged = { ...existingAiConfig, ...dto.aiConfig };
          const parsed = agentAiConfigUpdateSchema.parse(merged);
          aiConfigData = parsed as Prisma.InputJsonValue;
        } catch (error) {
          if (error instanceof ZodError) {
            throw new BadRequestException(
              `Invalid AI configuration: ${error.errors.map((e) => e.message).join(', ')}`,
            );
          }
          throw error;
        }
      }
    }

    try {
      // When `categoryKeywords` changes, previously-classified sessions are
      // still labelled against the OLD list. We don't auto-reclassify here
      // (would be expensive on a big agent) — the next message into a session
      // re-opens it, then the cron will pick it up again. Stale labels on
      // closed sessions stay until manually refreshed, which is acceptable
      // for an MVP and surfaceable later as a "reclassify all" admin action.
      const updated = await this.prisma.agent.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(normalizedDomains !== undefined && { allowedDomains: normalizedDomains }),
          ...(dto.voiceEnabled !== undefined && { voiceEnabled: dto.voiceEnabled }),
          ...(voiceConfigData !== undefined && { voiceConfig: voiceConfigData }),
          ...(dto.welcomeMessage !== undefined && { welcomeMessage: dto.welcomeMessage }),
          ...(dto.systemPrompt !== undefined && { systemPrompt: dto.systemPrompt }),
          ...(aiConfigData !== undefined && { aiConfig: aiConfigData }),
          ...(dto.categoryKeywords !== undefined && {
            // Dedupe case-insensitively but preserve the user's casing for the
            // first occurrence — Sentry vs sentry shouldn't both end up in
            // the analytics dropdown.
            categoryKeywords: dedupeCategoryKeywords(dto.categoryKeywords),
          }),
          ...(dto.supportedLanguages !== undefined && {
            // Zod already enforces enum membership + de-duplication; storing
            // verbatim. Order is preserved so the UI can echo back the agent
            // owner's chosen ordering on edit.
            supportedLanguages: dto.supportedLanguages,
          }),
          ...(dto.sessionLifetimeHours !== undefined && {
            sessionLifetimeHours: dto.sessionLifetimeHours,
          }),
          ...(dto.fallbackPhrases !== undefined && {
            fallbackPhrases: dto.fallbackPhrases,
          }),
          ...(dto.humanTakeoverEnabled !== undefined && {
            humanTakeoverEnabled: dto.humanTakeoverEnabled,
          }),
          ...(dto.showTalkToHumanButton !== undefined && {
            showTalkToHumanButton: dto.showTalkToHumanButton,
          }),
          ...(dto.humanConnectedLabel !== undefined && {
            humanConnectedLabel: dto.humanConnectedLabel,
          }),
        },
        include: { organization: { select: { id: true, name: true } } },
      });

      // Audit: domain changes
      if (normalizedDomains !== undefined) {
        await this.agentLogger.logDomainsUpdated(updated.id, {
          oldDomains: existing.allowedDomains,
          newDomains: normalizedDomains,
          userId: user.id,
        });
      }

      // Audit: status changes
      if (dto.status !== undefined && dto.status !== existing.status) {
        await this.agentLogger.logStatusChanged(updated.id, {
          oldStatus: existing.status,
          newStatus: dto.status,
        });
      }

      // Audit: voice configuration changes
      if (dto.voiceEnabled !== undefined && dto.voiceEnabled !== existing.voiceEnabled) {
        await this.agentLogger.logAgentUpdated(updated.id, {
          event: 'AGENT_VOICE_TOGGLED',
          oldVoiceEnabled: existing.voiceEnabled,
          newVoiceEnabled: dto.voiceEnabled,
          userId: user.id,
        });
      }
      if (dto.voiceConfig !== undefined) {
        await this.agentLogger.logAgentUpdated(updated.id, {
          event: 'AGENT_VOICE_CONFIG_UPDATED',
          userId: user.id,
        });
      }

      // Audit: AI config changes. Routing mode transitions (n8n↔direct) are
      // significant enough to warrant a dedicated audit event so a dashboard
      // timeline can show when an agent switched LLM backends.
      if (dto.aiConfig !== undefined) {
        const oldRoutingMode =
          (existing.aiConfig as { routingMode?: string } | null)?.routingMode ??
          'n8n';
        const newRoutingMode = dto.aiConfig?.routingMode ?? oldRoutingMode;
        await this.agentLogger.logAgentUpdated(updated.id, {
          event: 'AGENT_AI_CONFIG_UPDATED',
          oldRoutingMode,
          newRoutingMode,
          changedFields: Object.keys(dto.aiConfig ?? {}),
          userId: user.id,
        });
      }

      await this.agentLogger.logAgentUpdated(updated.id, { agent: updated, request: dto, userId: user.id });
      this.log.info('update', 'agent updated', { agentId: updated.id });
      // Bust the cache so the next chat turn reads fresh aiConfig / systemPrompt /
      // voiceConfig. Invalidation is best-effort (fail-open, see AgentCacheService).
      await this.agentCache.invalidate(updated.id);
      // If allowedDomains changed, also bust the per-replica CORS cache so the
      // very next widget request from this node sees the new list — without
      // this, dashboard edits sit behind the 10-min TTL.
      if (normalizedDomains !== undefined) {
        this.widgetCorsCache.invalidate({ id: updated.id, publicId: updated.publicId });
      }
      return this.stripSensitiveFields(updated, user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Agent not found');
      }
      this.log.error('update', 'agent update failed', error, { agentId: id });
      await this.agentLogger.logAgentUpdateException(id, error, { request: dto, userId: user.id });
      throw error;
    }
  }

  async softDelete(id: string, user: CurrentUserData) {
    await this.findByIdRaw(id, user);

    const deleted = await this.prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.agentLogger.logAgentDeleted(deleted.id, { agent: deleted, userId: user.id });
    this.log.info('softDelete', 'agent soft-deleted', { agentId: deleted.id });
    return deleted;
  }

  /**
   * Check if an agent is active. For future use by widget/chat API.
   */
  async checkAgentActive(agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { status: true },
    });
    return agent?.status === 'ACTIVE';
  }

  /**
   * Public: fetch agent info for the demo page (no auth required).
   * Only returns active, non-deleted agents with safe public fields.
   */
  async getDemoInfo(id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        publicId: true,
        name: true,
        welcomeMessage: true,
        voiceEnabled: true,
        voiceConfig: true,
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId: id },
    });

    return {
      id: agent.id,
      publicId: agent.publicId,
      name: agent.name,
      welcomeMessage: agent.welcomeMessage,
      theme: theme?.config ?? null,
      voiceConfig: agent.voiceEnabled && agent.voiceConfig
        ? this.sanitizeVoiceConfigForWidget(agent.voiceConfig as Record<string, unknown>)
        : null,
    };
  }

  /**
   * Public: fetch widget configuration by publicId (no auth required).
   * Returns theme, agent info, allowed domains, and theme version for ETag.
   */
  async getWidgetConfig(publicId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { publicId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        welcomeMessage: true,
        allowedDomains: true,
        voiceEnabled: true,
        voiceConfig: true,
        humanTakeoverEnabled: true,
        showTalkToHumanButton: true,
        humanConnectedLabel: true,
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId: agent.id },
    });

    const themeConfig = (theme?.config ?? null) as Record<string, unknown> | null;
    const starters: string[] = Array.isArray(themeConfig?.starters)
      ? (themeConfig.starters as Array<{ message?: string }>)
          .map((s) => (typeof s === 'string' ? s : s?.message ?? ''))
          .filter(Boolean)
      : [];

    return {
      config: {
        theme: themeConfig,
        agent: {
          name: agent.name,
          greeting: agent.welcomeMessage ?? '',
          starters,
          voiceEnabled: agent.voiceEnabled && !!agent.voiceConfig,
          voiceConfig: agent.voiceEnabled && agent.voiceConfig
            ? this.sanitizeVoiceConfigForWidget(agent.voiceConfig as Record<string, unknown>)
            : null,
          // Human handover (live agent takeover). The widget renders the
          // "Talk to a human" button only when both are true; humanConnectedLabel
          // is the text shown when a teammate joins.
          humanTakeoverEnabled: agent.humanTakeoverEnabled,
          showTalkToHumanButton: agent.humanTakeoverEnabled && agent.showTalkToHumanButton,
          humanConnectedLabel: agent.humanConnectedLabel,
        },
        allowedDomains: agent.allowedDomains,
      },
      version: theme?.version ?? 0,
    };
  }

  /** Strip provider internals from voiceConfig before exposing to public widget endpoint */
  private sanitizeVoiceConfigForWidget(config: Record<string, unknown>) {
    return {
      sttEnabled: config.sttEnabled ?? true,
      ttsEnabled: config.ttsEnabled ?? true,
      defaultLanguage: config.defaultLanguage ?? 'en',
      supportedLanguages: config.supportedLanguages ?? ['en'],
      autoDetectLanguage: config.autoDetectLanguage ?? true,
    };
  }

  // ==========================================
  // Webhook Management
  // ==========================================

  async setWebhookUrl(agentId: string, webhookUrl: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    // Enforce HTTPS in production
    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      !webhookUrl.startsWith('https://')
    ) {
      throw new BadRequestException('Webhook URL must use HTTPS in production');
    }

    const encrypted = this.cryptoService.encrypt(webhookUrl);

    const existing = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    await this.prisma.agentSecret.upsert({
      where: { agentId },
      create: { agentId, webhookUrl: encrypted },
      update: { webhookUrl: encrypted },
    });

    if (existing) {
      await this.agentLogger.logSecretUpdated(agentId, user.id);
    } else {
      await this.agentLogger.logSecretCreated(agentId, user.id);
    }
    await this.agentLogger.logWebhookUpdated(agentId, user.id);
    this.log.info('setWebhookUrl', 'webhook url updated', { agentId, replaced: !!existing });

    return { message: 'Webhook URL updated' };
  }

  async getWebhookUrl(agentId: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    const secret = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    if (secret?.webhookUrl) {
      return { webhookUrl: this.cryptoService.decrypt(secret.webhookUrl) };
    }

    const fallback = this.configService.get<string>('DEFAULT_WEBHOOK_URL');
    if (fallback) {
      return { webhookUrl: fallback, isFallback: true };
    }

    return { webhookUrl: null };
  }

  /**
   * Get the effective webhook URL for internal use (resolves fallback).
   */
  async getEffectiveWebhookUrl(agentId: string): Promise<string> {
    const secret = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    if (secret?.webhookUrl) {
      return this.cryptoService.decrypt(secret.webhookUrl);
    }

    const fallback = this.configService.get<string>('DEFAULT_WEBHOOK_URL');
    if (!fallback) {
      throw new NotFoundException('No webhook URL configured for this agent');
    }
    return fallback;
  }

  async testWebhook(agentId: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    let url: string;
    try {
      url = await this.getEffectiveWebhookUrl(agentId);
    } catch {
      throw new NotFoundException('No webhook URL configured for this agent');
    }

    const payload = {
      type: 'test',
      agentId,
      timestamp: new Date().toISOString(),
    };

    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_TEST_TIMEOUT),
      });

      this.log.info('testWebhook', 'webhook test completed', {
        agentId,
        statusCode: response.status,
        ok: response.ok,
        ms: Date.now() - startTime,
      });
      return {
        success: response.ok,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      this.log.warn('testWebhook', `webhook test failed for agent ${agentId}`, {
        err: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        success: false,
        statusCode: null,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================
  // Internal helpers
  // ==========================================

  /**
   * Internal: fetch agent without stripping sensitive fields.
   * Used by update/softDelete which need the full agent record.
   */
  private async findByIdRaw(id: string, user: CurrentUserData): Promise<Agent> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }

  /**
   * Strip sensitive fields from agent response for CLIENT users.
   * CLIENT users should not see allowedDomains.
   */
  private stripSensitiveFields(
    agent: Agent,
    user: CurrentUserData,
  ): Omit<Agent, 'allowedDomains'> | Agent {
    if (user.role === Role.CLIENT) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { allowedDomains, ...safe } = agent;
      return safe;
    }
    return agent;
  }
}
