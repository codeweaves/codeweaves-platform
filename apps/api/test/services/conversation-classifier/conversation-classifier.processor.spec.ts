import { Test, TestingModule } from '@nestjs/testing';
import { ConversationClassifierProcessor } from '../../../src/services/conversation-classifier.processor';
import { ConversationClassifierService } from '../../../src/services/conversation-classifier.service';

describe('ConversationClassifierProcessor', () => {
  let processor: ConversationClassifierProcessor;

  const mockClassifier = {
    runBatch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationClassifierProcessor,
        { provide: ConversationClassifierService, useValue: mockClassifier },
      ],
    }).compile();

    processor = module.get(ConversationClassifierProcessor);
    jest.clearAllMocks();
  });

  it('forwards to runBatch and returns the processed count', async () => {
    mockClassifier.runBatch.mockResolvedValue(7);

    const result = await processor.process();

    expect(mockClassifier.runBatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 7 });
  });

  it('returns processed: 0 when the classifier finds nothing to do', async () => {
    mockClassifier.runBatch.mockResolvedValue(0);

    const result = await processor.process();

    expect(result).toEqual({ processed: 0 });
  });
});
