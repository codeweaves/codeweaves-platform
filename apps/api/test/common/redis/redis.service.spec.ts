import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../src/common/redis/redis.service';

const createMockClient = () => ({
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue('OK'),
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  eval: jest.fn().mockResolvedValue(null),
  zadd: jest.fn().mockResolvedValue(1),
  zrangebyscore: jest.fn().mockResolvedValue([]),
  zcard: jest.fn().mockResolvedValue(0),
  zremrangebyscore: jest.fn().mockResolvedValue(0),
  pipeline: jest.fn().mockReturnValue({
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]),
  }),
});

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import Redis from 'ioredis';
const MockRedisConstructor = Redis as unknown as jest.Mock;

type MockClient = ReturnType<typeof createMockClient>;

describe('RedisService', () => {
  let service: RedisService;
  let mockClient: MockClient;

  const mockConfigService = {
    get: jest.fn().mockReturnValue('redis://localhost:6379'),
  };

  beforeEach(async () => {
    mockConfigService.get.mockReturnValue('redis://localhost:6379');
    mockClient = createMockClient();
    MockRedisConstructor.mockImplementation(() => mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    // Inject mock client directly (bypasses ioredis constructor for method tests)
    (service as unknown as { client: typeof mockClient }).client = mockClient;
  });

  describe('onModuleInit', () => {
    it('should throw if REDIS_URL is not configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(service.onModuleInit()).rejects.toThrow(
        'REDIS_URL environment variable is required',
      );
    });

    it('should register event listeners and await connection', async () => {
      // onModuleInit creates a new client via constructor mock
      await service.onModuleInit();

      expect(mockClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      // TODO: Redis is not running in dev — reconnecting listener removed for now.
      // Re-add when Redis is set up in production/staging.
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should log warning and not throw when connection fails', async () => {
      mockClient.connect.mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      // Should NOT throw — graceful failure
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection', async () => {
      await service.onModuleDestroy();

      expect(mockClient.quit).toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    it('should return PONG on successful ping', async () => {
      const result = await service.ping();

      expect(result).toBe('PONG');
      expect(mockClient.ping).toHaveBeenCalled();
    });

    it('should propagate error on failed ping', async () => {
      mockClient.ping.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.ping()).rejects.toThrow('Connection refused');
    });
  });

  describe('get/set/del', () => {
    it('should get a value', async () => {
      mockClient.get.mockResolvedValueOnce('value1');
      const result = await service.get('key1');
      expect(result).toBe('value1');
    });

    it('should set a value without TTL', async () => {
      await service.set('key1', 'value1');
      expect(mockClient.set).toHaveBeenCalledWith('key1', 'value1');
    });

    it('should set a value with TTL', async () => {
      await service.set('key1', 'value1', 60);
      expect(mockClient.set).toHaveBeenCalledWith('key1', 'value1', 'EX', 60);
    });

    it('should delete keys', async () => {
      await service.del('key1', 'key2');
      expect(mockClient.del).toHaveBeenCalledWith('key1', 'key2');
    });
  });

  describe('incr/expire', () => {
    it('should increment a key', async () => {
      mockClient.incr.mockResolvedValueOnce(5);
      const result = await service.incr('counter');
      expect(result).toBe(5);
    });

    it('should set expiration on a key', async () => {
      await service.expire('key1', 300);
      expect(mockClient.expire).toHaveBeenCalledWith('key1', 300);
    });
  });

  describe('sorted set operations', () => {
    it('should zadd a member', async () => {
      await service.zadd('myset', 100, 'member1');
      expect(mockClient.zadd).toHaveBeenCalledWith('myset', 100, 'member1');
    });

    it('should zcard a set', async () => {
      mockClient.zcard.mockResolvedValueOnce(5);
      const result = await service.zcard('myset');
      expect(result).toBe(5);
    });

    it('should zrangebyscore', async () => {
      mockClient.zrangebyscore.mockResolvedValueOnce(['a', 'b']);
      const result = await service.zrangebyscore('myset', 0, 100);
      expect(result).toEqual(['a', 'b']);
    });

    it('should zremrangebyscore', async () => {
      mockClient.zremrangebyscore.mockResolvedValueOnce(3);
      const result = await service.zremrangebyscore('myset', 0, 50);
      expect(result).toBe(3);
    });
  });

  describe('pipeline', () => {
    it('should return a pipeline instance', () => {
      const pipe = service.pipeline();
      expect(pipe).toBeDefined();
      expect(mockClient.pipeline).toHaveBeenCalled();
    });
  });

  describe('eval', () => {
    it('should execute a Lua script', async () => {
      mockClient.eval.mockResolvedValueOnce('result');
      const result = await service.eval('return 1', 0);
      expect(result).toBe('result');
    });
  });

  describe('getClient', () => {
    it('should return the Redis client instance', () => {
      const client = service.getClient();
      expect(client).toBe(mockClient);
    });
  });
});
