import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../../../src/controllers/public/health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return health status with timestamp and version', () => {
      const result = controller.getHealth();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('version', '1.0.0');
      expect(result).toHaveProperty('timestamp');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('ping', () => {
    it('should return pong message', () => {
      const result = controller.ping();

      expect(result).toEqual({ message: 'pong' });
    });
  });
});
