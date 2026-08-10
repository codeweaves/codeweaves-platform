import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AgentLoggerService } from '../common/logger/agent.logger';
import { AppLogger } from '../common/logger/app-logger';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { defaultWidgetTheme } from '../models/agent-theme.dto';
import type { WidgetTheme, PartialWidgetTheme } from '../models/agent-theme.dto';
import { PermissionCatalogService } from '../common/rbac/permission-catalog.service';
import { isOrgScoped } from '../utils/tenant-filter';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const sourceVal = source[key];
    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) || {},
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

@Injectable()
export class AgentThemesService {
  private readonly log = new AppLogger(AgentThemesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  async getTheme(agentId: string, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId },
    });

    if (!theme) {
      return { config: defaultWidgetTheme, version: 0 };
    }

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async updateTheme(agentId: string, config: WidgetTheme, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const safeConfig = await this.preserveBrandingUnlessPermitted(agentId, config, user);
    const jsonConfig = toJsonValue(safeConfig);

    const theme = await this.prisma.agentTheme.upsert({
      where: { agentId },
      create: { agentId, config: jsonConfig, version: 1 },
      update: { config: jsonConfig, version: { increment: 1 } },
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);
    this.log.info('updateTheme', 'theme replaced', { agentId, version: theme.version });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async patchTheme(agentId: string, partialConfig: PartialWidgetTheme, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const theme = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.agentTheme.findUnique({
        where: { agentId },
      });

      const currentConfig = existing
        ? (existing.config as WidgetTheme)
        : defaultWidgetTheme;

      const merged = deepMerge(currentConfig, partialConfig) as WidgetTheme;
      // Branding is granted deliberately. See preserveBrandingUnlessPermitted.
      if (!this.canEditBranding(user)) {
        merged.branding = currentConfig.branding ?? defaultWidgetTheme.branding;
      }
      const jsonConfig = toJsonValue(merged);

      return tx.agentTheme.upsert({
        where: { agentId },
        create: { agentId, config: jsonConfig, version: 1 },
        update: { config: jsonConfig, version: { increment: 1 } },
      });
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);
    this.log.info('patchTheme', 'theme patched', { agentId, version: theme.version });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async resetTheme(agentId: string, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const jsonConfig = toJsonValue(defaultWidgetTheme);

    const theme = await this.prisma.agentTheme.upsert({
      where: { agentId },
      create: { agentId, config: jsonConfig, version: 1 },
      update: { config: jsonConfig, version: { increment: 1 } },
    });

    await this.agentLogger.logThemeReset(agentId, user.id);
    this.log.info('resetTheme', 'theme reset to default', { agentId, version: theme.version });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  /** Does this caller hold the branding permission? */
  private canEditBranding(user: CurrentUserData): boolean {
    return this.catalog
      .resolvePermissions(user.roleKeys ?? [])
      .has('AgentTheme:UpdateBranding');
  }

  /**
   * Keep the stored branding unless the caller may change it.
   *
   * Branding is the "Powered by Klivo" footer, so it is the white-label lever and
   * granted deliberately via `org.agent_branding` rather than coming with
   * ordinary theme access. It cannot be gated by the route's permission the way
   * other sections are, because appearance, chat interface and branding all live
   * in the SAME JSONB column and one endpoint writes the whole thing. A
   * permission decides whether a call is allowed; it cannot decide which keys
   * inside one value a caller may set. So this is a field-level rule, kept at the
   * single place that writes the column.
   *
   * The editor hides the section for these users; this is the boundary that
   * holds when someone calls the API directly.
   */
  private async preserveBrandingUnlessPermitted(
    agentId: string,
    config: WidgetTheme,
    user: CurrentUserData,
  ): Promise<WidgetTheme> {
    if (this.canEditBranding(user)) return config;

    const existing = await this.prisma.agentTheme.findUnique({
      where: { agentId },
      select: { config: true },
    });

    const storedBranding = existing
      ? (existing.config as WidgetTheme).branding
      : undefined;

    return {
      ...config,
      branding: storedBranding ?? defaultWidgetTheme.branding,
    };
  }

  private async ensureAgentAccess(agentId: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(isOrgScoped(user) && { organizationId: user.organizationId! }),
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }
}
