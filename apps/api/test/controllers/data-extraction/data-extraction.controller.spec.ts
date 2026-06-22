import { Test, TestingModule } from '@nestjs/testing';
import { DataExtractionController } from '../../../src/controllers/data-extraction/data-extraction.controller';
import { DataExtractionService } from '../../../src/services/data-extraction.service';
import { InternalSecretGuard } from '../../../src/guards/internal-secret.guard';

describe('DataExtractionController', () => {
  let controller: DataExtractionController;

  const mockService = {
    triggerDuePass: jest.fn(),
    extractForSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DataExtractionController],
      providers: [{ provide: DataExtractionService, useValue: mockService }],
    })
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(DataExtractionController);
  });

  it('triggers a background due pass and acks immediately when no sessionId is given', async () => {
    mockService.triggerDuePass.mockReturnValue(true);
    const res = await controller.run(undefined);
    expect(res).toEqual({ mode: 'due-pass', started: true });
    expect(mockService.triggerDuePass).toHaveBeenCalledTimes(1);
    expect(mockService.extractForSession).not.toHaveBeenCalled();
  });

  it('reports started=false when a pass is already running', async () => {
    mockService.triggerDuePass.mockReturnValue(false);
    const res = await controller.run({});
    expect(res).toEqual({ mode: 'due-pass', started: false });
  });

  it('extracts a single session when sessionId is given (skips the due pass)', async () => {
    mockService.extractForSession.mockResolvedValue('captured');
    const res = await controller.run({ sessionId: 'sess-1' });
    expect(res).toEqual({
      mode: 'single',
      sessionId: 'sess-1',
      outcome: 'captured',
    });
    expect(mockService.extractForSession).toHaveBeenCalledWith('sess-1');
    expect(mockService.triggerDuePass).not.toHaveBeenCalled();
  });
});
