import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from '../../../src/services/app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHello', () => {
    it('should return hello message', () => {
      expect(service.getHello()).toBe('Hello from Klivo API!');
    });
  });

  describe('getHealth', () => {
    it('should return health status with timestamp', () => {
      const result = service.getHealth();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
