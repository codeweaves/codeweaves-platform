import { Test } from '@nestjs/testing';
import { AgentToolsService } from '../../../src/modules/integrations/agent-tools.service';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service';
import { ProviderRegistry } from '../../../src/modules/integrations/provider-registry';
import { HubspotProvider } from '../../../src/modules/integrations/providers/hubspot.provider';
import { SlackProvider } from '../../../src/modules/integrations/providers/slack.provider';
import { IntegrationLoggerService } from '../../../src/common/logger/integration.logger';
import { PrismaService } from '../../../src/services/prisma.service';

describe('AgentToolsService', () => {
  let service: AgentToolsService;

  const agentId = 'agent-uuid';

  const mockPrisma = {
    agentIntegration: { findMany: jest.fn() },
  };
  const mockIntegrations = {
    decryptCredentials: jest.fn(),
  };
  const mockIntegrationLogger = {
    logToolCall: jest.fn().mockResolvedValue(undefined),
    logToolCallFailed: jest.fn().mockResolvedValue(undefined),
  };

  const hubspotRow = {
    id: 'integ-1',
    agentId,
    provider: 'hubspot',
    enabled: true,
    credentialsEncrypted: 'enc',
  };
  const slackRow = {
    id: 'integ-2',
    agentId,
    provider: 'slack',
    enabled: true,
    credentialsEncrypted: 'enc',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockIntegrations.decryptCredentials.mockImplementation(
      (row: { provider: string }) =>
        row.provider === 'hubspot'
          ? { accessToken: 'pat-na1-token' }
          : { webhookUrl: 'https://hooks.slack.com/services/T0/B0/x' },
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentToolsService,
        ProviderRegistry,
        HubspotProvider,
        SlackProvider,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IntegrationsService, useValue: mockIntegrations },
        { provide: IntegrationLoggerService, useValue: mockIntegrationLogger },
      ],
    }).compile();
    service = moduleRef.get(AgentToolsService);
  });

  it('returns null for agents with no enabled integrations', async () => {
    mockPrisma.agentIntegration.findMany.mockResolvedValue([]);
    expect(await service.buildToolsForAgent(agentId, {})).toBeNull();
    expect(mockPrisma.agentIntegration.findMany).toHaveBeenCalledWith({
      where: { agentId, enabled: true },
    });
  });

  it('builds tools + step metadata for connected providers', async () => {
    mockPrisma.agentIntegration.findMany.mockResolvedValue([
      hubspotRow,
      slackRow,
    ]);
    const bundle = await service.buildToolsForAgent(agentId, {
      sessionId: 'sess-1',
    });
    expect(bundle).not.toBeNull();
    expect(Object.keys(bundle!.tools).sort()).toEqual([
      'hubspot_find_contact',
      'hubspot_save_contact',
      'slack_notify_team',
    ]);
    expect(bundle!.stepMeta.hubspot_find_contact).toMatchObject({
      activeLabel: expect.any(String),
      doneLabel: expect.any(String),
    });
  });

  it('skips integrations whose credentials fail to decrypt (chat survives)', async () => {
    mockPrisma.agentIntegration.findMany.mockResolvedValue([
      hubspotRow,
      slackRow,
    ]);
    mockIntegrations.decryptCredentials.mockImplementation(
      (row: { provider: string }) => {
        if (row.provider === 'hubspot') throw new Error('bad key');
        return { webhookUrl: 'https://hooks.slack.com/services/T0/B0/x' };
      },
    );
    const bundle = await service.buildToolsForAgent(agentId, {});
    expect(Object.keys(bundle!.tools)).toEqual(['slack_notify_team']);
  });

  it('skips unknown providers gracefully', async () => {
    mockPrisma.agentIntegration.findMany.mockResolvedValue([
      { ...hubspotRow, provider: 'salesforce' },
    ]);
    expect(await service.buildToolsForAgent(agentId, {})).toBeNull();
  });

  it('wraps execute: logs the call and converts throws into readable strings', async () => {
    mockPrisma.agentIntegration.findMany.mockResolvedValue([slackRow]);
    const bundle = await service.buildToolsForAgent(agentId, {
      sessionId: 'sess-1',
      traceId: 't_123',
    });
    const slackTool = bundle!.tools.slack_notify_team!;

    // Force the underlying fetch to explode.
    const realFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    try {
      const result = await slackTool.execute!(
        { message: 'hot lead' },
        { toolCallId: 'call-1', messages: [] },
      );
      // SlackProvider itself converts network errors to a string result; the
      // wrapper must pass that through and log success (no throw happened).
      expect(typeof result).toBe('string');
      expect(String(result)).toMatch(/failed|error/i);
      expect(mockIntegrationLogger.logToolCall).toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({
          provider: 'slack',
          tool: 'slack_notify_team',
          argKeys: ['message'],
          sessionId: 'sess-1',
          traceId: 't_123',
          ok: true,
        }),
      );
      // PII rule: the audit payload must not contain the message content.
      const logged = JSON.stringify(
        mockIntegrationLogger.logToolCall.mock.calls,
      );
      expect(logged).not.toContain('hot lead');
    } finally {
      global.fetch = realFetch;
    }
  });
});
