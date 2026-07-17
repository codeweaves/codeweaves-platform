import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { RedisService } from '../../../src/common/redis/redis.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('AgentCacheService (L1 + Redis read-through)', () => {
  let service: AgentCacheService;
  const mockRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const mockPrisma = { agent: { findFirst: jest.fn() } };
  const mockConfig = { get: jest.fn() };

  const dbAgent = {
    id: 'agent-1',
    name: 'Bot',
    knowledge: null,
    dataFields: [],
  };

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentCacheService,
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    return moduleRef.get(AgentCacheService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(undefined);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
    mockPrisma.agent.findFirst.mockResolvedValue(dbAgent);
    service = await build();
  });

  it('serves the second read from L1 — no Redis, no Postgres', async () => {
    const first = await service.getAgentWithKnowledge('agent-1');
    expect(first?.id).toBe('agent-1');
    expect(mockPrisma.agent.findFirst).toHaveBeenCalledTimes(1);

    const second = await service.getAgentWithKnowledge('agent-1');
    expect(second?.id).toBe('agent-1');
    // Still exactly one network/DB access each — L1 absorbed the second read.
    expect(mockRedis.get).toHaveBeenCalledTimes(1);
    expect(mockPrisma.agent.findFirst).toHaveBeenCalledTimes(1);
  });

  it('populates L1 from a Redis hit too', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(dbAgent));
    await service.getAgentWithKnowledge('agent-1');
    await service.getAgentWithKnowledge('agent-1');
    expect(mockRedis.get).toHaveBeenCalledTimes(1);
    expect(mockPrisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it('invalidate() clears L1 immediately — next read goes back to source', async () => {
    await service.getAgentWithKnowledge('agent-1');
    await service.invalidate('agent-1');
    expect(mockRedis.del).toHaveBeenCalledWith('agent:cache:agent-1');

    await service.getAgentWithKnowledge('agent-1');
    // Redis was consulted again (L1 entry gone).
    expect(mockRedis.get).toHaveBeenCalledTimes(2);
  });

  it('respects AGENT_CACHE_L1_TTL_MS=0 as an opt-out', async () => {
    mockConfig.get.mockImplementation((key: string) =>
      key === 'AGENT_CACHE_L1_TTL_MS' ? '0' : undefined,
    );
    service = await build();
    await service.getAgentWithKnowledge('agent-1');
    await service.getAgentWithKnowledge('agent-1');
    // No L1: both reads hit Redis.
    expect(mockRedis.get).toHaveBeenCalledTimes(2);
  });

  it('expires L1 entries after the TTL', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await service.getAgentWithKnowledge('agent-1');
      jest.setSystemTime(Date.now() + 46_000); // default TTL is 45s
      await service.getAgentWithKnowledge('agent-1');
      expect(mockRedis.get).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still falls through to Postgres when Redis is down', async () => {
    mockRedis.get.mockRejectedValue(new Error('redis down'));
    const result = await service.getAgentWithKnowledge('agent-1');
    expect(result?.id).toBe('agent-1');
  });

  it('does not cache null (missing agent) results', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    expect(await service.getAgentWithKnowledge('ghost')).toBeNull();
    expect(await service.getAgentWithKnowledge('ghost')).toBeNull();
    // Second read hit the DB again — no negative caching.
    expect(mockPrisma.agent.findFirst).toHaveBeenCalledTimes(2);
  });
});
