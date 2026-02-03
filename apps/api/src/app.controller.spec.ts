import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = module.get<AppController>(AppController);
    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHello', () => {
    it('should return the hello message from service', () => {
      const mockMessage = 'Test Message';
      jest.spyOn(service, 'getHello').mockReturnValue(mockMessage);

      expect(controller.getHello()).toBe(mockMessage);
    });
  });

  describe('getHealth', () => {
    it('should return health status from service', () => {
      const mockHealth = { status: 'ok', timestamp: '2024-01-01T00:00:00.000Z' };
      jest.spyOn(service, 'getHealth').mockReturnValue(mockHealth);

      expect(controller.getHealth()).toEqual(mockHealth);
    });
  });
});
