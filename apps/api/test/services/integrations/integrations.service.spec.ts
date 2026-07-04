import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service';
import { ProviderRegistry } from '../../../src/modules/integrations/provider-registry';
import { HubspotProvider } from '../../../src/modules/integrations/providers/hubspot.provider';
import { SlackProvider } from '../../../src/modules/integrations/providers/slack.provider';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { IntegrationLoggerService } from '../../../src/common/logger/integration.logger';
import { PrismaService } from '../../../src/services/prisma.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let hubspot: HubspotProvider;

  const agentId = 'agent-uuid';
  const orgId = 'org-uuid';

  const mockPrisma = {
    agent: { findFirst: jest.fn() },
    agentIntegration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  // Reversible fake crypto so decryptCredentials round-trips. Implementations
  // assigned in beforeEach (jest resetMocks:true wipes module-scope impls).
  const mockCrypto = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };
  const mockIntegrationLogger = {
    logIntegrationConnected: jest.fn(),
    logIntegrationDisconnected: jest.fn(),
    logIntegrationTest: jest.fn(),
  };
  const mockAgentCache = { invalidate: jest.fn() };

  const clientUser = {
    clerkId: 'clerk_1',
    email: 'client@org.com',
    id: 'user-uuid',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: null,
  } as unknown as CurrentUserData;

  const storedRow = {
    id: 'integ-uuid',
    agentId,
    organizationId: orgId,
    provider: 'hubspot',
    enabled: true,
    credentialsEncrypted: 'enc:{"accessToken":"pat-na1-secret-token"}',
    credentialHint: 'pat-…oken',
    config: {},
    status: 'connected',
    lastTestedAt: new Date(),
    createdById: 'user-uuid',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.encrypt.mockImplementation((s: string) => `enc:${s}`);
    mockCrypto.decrypt.mockImplementation((s: string) => s.replace(/^enc:/, ''));
    mockPrisma.agent.findFirst.mockResolvedValue({
      id: agentId,
      organizationId: orgId,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        ProviderRegistry,
        HubspotProvider,
        SlackProvider,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: IntegrationLoggerService, useValue: mockIntegrationLogger },
        { provide: AgentCacheService, useValue: mockAgentCache },
      ],
    }).compile();
    service = moduleRef.get(IntegrationsService);
    hubspot = moduleRef.get(HubspotProvider);
  });

  describe('tenant isolation', () => {
    it("404s when the agent belongs to another org", async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.list(agentId, clientUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.agentIntegration.findMany).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('returns masked responses without credentials', async () => {
      mockPrisma.agentIntegration.findMany.mockResolvedValue([storedRow]);
      const result = await service.list(agentId, clientUser);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        provider: 'hubspot',
        credentialHint: 'pat-…oken',
        status: 'connected',
      });
      // The encrypted blob must never leak through the API shape.
      expect(JSON.stringify(result)).not.toContain('credentialsEncrypted');
      expect(JSON.stringify(result)).not.toContain('secret-token');
    });
  });

  describe('upsert()', () => {
    it('validates, live-tests, encrypts and stores credentials', async () => {
      jest
        .spyOn(hubspot, 'testConnection')
        .mockResolvedValue({ ok: true, message: 'Connected' });
      mockPrisma.agentIntegration.upsert.mockResolvedValue(storedRow);

      const result = await service.upsert(
        agentId,
        'hubspot',
        {
          credentials: { accessToken: 'pat-na1-secret-token' },
          enabled: true,
        },
        clientUser,
      );

      expect(hubspot.testConnection).toHaveBeenCalledWith({
        accessToken: 'pat-na1-secret-token',
      });
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ accessToken: 'pat-na1-secret-token' }),
      );
      const upsertArgs = mockPrisma.agentIntegration.upsert.mock.calls[0][0];
      expect(upsertArgs.create.credentialsEncrypted).toMatch(/^enc:/);
      expect(upsertArgs.create.organizationId).toBe(orgId);
      expect(result.provider).toBe('hubspot');
      expect(mockIntegrationLogger.logIntegrationConnected).toHaveBeenCalled();
    });

    it('rejects when the live connection test fails', async () => {
      jest
        .spyOn(hubspot, 'testConnection')
        .mockResolvedValue({ ok: false, message: 'HTTP 401: invalid token' });
      await expect(
        service.upsert(
          agentId,
          'hubspot',
          { credentials: { accessToken: 'pat-na1-bad-token' }, enabled: true },
          clientUser,
        ),
      ).rejects.toThrow(/connection test failed/i);
      expect(mockPrisma.agentIntegration.upsert).not.toHaveBeenCalled();
    });

    it('rejects malformed credentials with the Zod message', async () => {
      await expect(
        service.upsert(
          agentId,
          'slack',
          { credentials: { webhookUrl: 'https://evil.com/hook' }, enabled: true },
          clientUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.agentIntegration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('test()', () => {
    it('re-tests with stored credentials and records the outcome', async () => {
      mockPrisma.agentIntegration.findUnique.mockResolvedValue(storedRow);
      mockPrisma.agentIntegration.update.mockResolvedValue(storedRow);
      jest
        .spyOn(hubspot, 'testConnection')
        .mockResolvedValue({ ok: false, message: 'HTTP 401' });

      const result = await service.test(agentId, 'hubspot', clientUser);

      expect(hubspot.testConnection).toHaveBeenCalledWith({
        accessToken: 'pat-na1-secret-token',
      });
      expect(result.ok).toBe(false);
      expect(mockPrisma.agentIntegration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'error' }),
        }),
      );
    });

    it('404s when the integration does not exist', async () => {
      mockPrisma.agentIntegration.findUnique.mockResolvedValue(null);
      await expect(service.test(agentId, 'hubspot', clientUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove()', () => {
    it('deletes the integration', async () => {
      mockPrisma.agentIntegration.findUnique.mockResolvedValue(storedRow);
      mockPrisma.agentIntegration.delete.mockResolvedValue(storedRow);
      await service.remove(agentId, 'hubspot', clientUser);
      expect(mockPrisma.agentIntegration.delete).toHaveBeenCalledWith({
        where: { id: 'integ-uuid' },
      });
      expect(
        mockIntegrationLogger.logIntegrationDisconnected,
      ).toHaveBeenCalled();
    });
  });
});
