import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AgentIntegration } from '@prisma/client';
import { ZodError } from 'zod';
import type {
  AgentIntegrationResponse,
  IntegrationProvider,
  UpsertIntegrationDto,
} from '@repo/validation';

import { AgentCacheService } from '../../common/cache/agent-cache.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { IntegrationLoggerService } from '../../common/logger/integration.logger';
import type { CurrentUserData } from '../../decorators/current-user.decorator';
import { PrismaService } from '../../services/prisma.service';
import { assertAgentAccessible } from '../../utils/agent-access.util';

import { ProviderRegistry } from './provider-registry';

/**
 * IntegrationsService: connect / test / disconnect third-party integrations
 * per agent.
 *
 * Credential handling rules (non-negotiable):
 *   - encrypted at rest (AES-256-GCM via CryptoService, same as agent secrets)
 *   - decrypted ONLY at call time (test / chat tool building)
 *   - NEVER returned by any API — responses carry a masked `credentialHint`
 *   - NEVER logged
 *
 * Tenancy: every method resolves the agent through assertAgentAccessible.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: ProviderRegistry,
    private readonly integrationLogger: IntegrationLoggerService,
    private readonly agentCache: AgentCacheService,
  ) {}

  async list(
    agentId: string,
    user: CurrentUserData,
  ): Promise<AgentIntegrationResponse[]> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const rows = await this.prisma.agentIntegration.findMany({
      where: { agentId },
      orderBy: { provider: 'asc' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  /**
   * Connect or update an integration. Credentials are validated against the
   * provider schema, then verified LIVE (a bad token fails here, not later in
   * front of a customer), then stored encrypted.
   */
  async upsert(
    agentId: string,
    provider: IntegrationProvider,
    dto: UpsertIntegrationDto,
    user: CurrentUserData,
  ): Promise<AgentIntegrationResponse> {
    const agent = await assertAgentAccessible(this.prisma, agentId, user);
    const def = this.registry.get(provider);

    let credentials: Record<string, string>;
    try {
      credentials = def.parseCredentials(dto.credentials);
    } catch (err) {
      throw new BadRequestException(
        err instanceof ZodError
          ? err.issues.map((i) => i.message).join('; ')
          : 'Invalid credentials.',
      );
    }

    const test = await def.testConnection(credentials);
    if (!test.ok) {
      throw new BadRequestException(`Connection test failed: ${test.message}`);
    }

    const row = await this.prisma.agentIntegration.upsert({
      where: { agentId_provider: { agentId, provider } },
      create: {
        agentId,
        organizationId: agent.organizationId,
        provider,
        enabled: dto.enabled,
        credentialsEncrypted: this.crypto.encrypt(JSON.stringify(credentials)),
        credentialHint: def.credentialHint(credentials),
        config: (dto.config ?? {}) as object,
        status: 'connected',
        lastTestedAt: new Date(),
        createdById: user.id,
      },
      update: {
        enabled: dto.enabled,
        credentialsEncrypted: this.crypto.encrypt(JSON.stringify(credentials)),
        credentialHint: def.credentialHint(credentials),
        config: (dto.config ?? {}) as object,
        status: 'connected',
        lastTestedAt: new Date(),
      },
    });

    // Chat reads integrations from the agent cache — refresh it.
    await this.agentCache.invalidate(agentId);
    void this.integrationLogger.logIntegrationConnected(agentId, {
      provider,
      enabled: dto.enabled,
      by: user.id,
    });
    this.logger.log(
      `[upsert] - ${provider} connected for agent ${agentId} (enabled=${dto.enabled})`,
    );
    return this.toResponse(row);
  }

  /** Re-run the provider connection test with the STORED credentials. */
  async test(
    agentId: string,
    provider: IntegrationProvider,
    user: CurrentUserData,
  ): Promise<{ ok: boolean; message: string }> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const row = await this.requireIntegration(agentId, provider);
    const def = this.registry.get(provider);

    const credentials = this.decryptCredentials(row);
    const result = await def.testConnection(credentials);

    await this.prisma.agentIntegration.update({
      where: { id: row.id },
      data: { status: result.ok ? 'connected' : 'error', lastTestedAt: new Date() },
    });
    void this.integrationLogger.logIntegrationTest(agentId, {
      provider,
      ok: result.ok,
      message: result.message,
    });
    return result;
  }

  /** Toggle without re-entering credentials. */
  async setEnabled(
    agentId: string,
    provider: IntegrationProvider,
    enabled: boolean,
    user: CurrentUserData,
  ): Promise<AgentIntegrationResponse> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const row = await this.requireIntegration(agentId, provider);
    const updated = await this.prisma.agentIntegration.update({
      where: { id: row.id },
      data: { enabled },
    });
    await this.agentCache.invalidate(agentId);
    return this.toResponse(updated);
  }

  async remove(
    agentId: string,
    provider: IntegrationProvider,
    user: CurrentUserData,
  ): Promise<void> {
    await assertAgentAccessible(this.prisma, agentId, user);
    const row = await this.requireIntegration(agentId, provider);
    await this.prisma.agentIntegration.delete({ where: { id: row.id } });
    await this.agentCache.invalidate(agentId);
    void this.integrationLogger.logIntegrationDisconnected(agentId, {
      provider,
      by: user.id,
    });
  }

  // --------------------------------------------------------------------------
  // Internal (used by AgentToolsService on the chat hot path)
  // --------------------------------------------------------------------------

  decryptCredentials(row: AgentIntegration): Record<string, string> {
    return JSON.parse(this.crypto.decrypt(row.credentialsEncrypted)) as Record<
      string,
      string
    >;
  }

  private async requireIntegration(
    agentId: string,
    provider: IntegrationProvider,
  ): Promise<AgentIntegration> {
    const row = await this.prisma.agentIntegration.findUnique({
      where: { agentId_provider: { agentId, provider } },
    });
    if (!row) {
      throw new NotFoundException(`No ${provider} integration for this agent.`);
    }
    return row;
  }

  private toResponse(row: AgentIntegration): AgentIntegrationResponse {
    return {
      id: row.id,
      agentId: row.agentId,
      provider: row.provider as IntegrationProvider,
      enabled: row.enabled,
      credentialHint: row.credentialHint,
      status: (row.status === 'error' ? 'error' : 'connected') as
        | 'connected'
        | 'error',
      lastTestedAt: row.lastTestedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
