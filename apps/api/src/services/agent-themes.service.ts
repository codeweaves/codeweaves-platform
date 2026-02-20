import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AgentLoggerService } from '../common/logger/agent.logger';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { defaultWidgetTheme } from '../models/agent-theme.dto';
import type { WidgetTheme, PartialWidgetTheme } from '../models/agent-theme.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
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

    const jsonConfig = toJsonValue(config);

    const theme = await this.prisma.agentTheme.upsert({
      where: { agentId },
      create: { agentId, config: jsonConfig, version: 1 },
      update: { config: jsonConfig, version: { increment: 1 } },
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);

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
      const jsonConfig = toJsonValue(merged);

      return tx.agentTheme.upsert({
        where: { agentId },
        create: { agentId, config: jsonConfig, version: 1 },
        update: { config: jsonConfig, version: { increment: 1 } },
      });
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);

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

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  private async ensureAgentAccess(agentId: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }
}
