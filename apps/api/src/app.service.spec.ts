import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';

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
    it('should return the welcome message', () => {
      expect(service.getHello()).toBe('Hello from CodeWeaves API!');
    });
  });

  describe('getHealth', () => {
    it('should return health status with ok status', () => {
      const result = service.getHealth();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('should return a valid ISO timestamp', () => {
      const result = service.getHealth();
      const date = new Date(result.timestamp);

      expect(date.toISOString()).toBe(result.timestamp);
    });
  });
});
