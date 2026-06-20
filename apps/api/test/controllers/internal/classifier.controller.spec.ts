import { ClassifierController } from '../../../src/controllers/internal/classifier.controller';
import type { ConversationClassifierService } from '../../../src/services/conversation-classifier.service';

describe('ClassifierController', () => {
  let classifier: { runBatch: jest.Mock };
  let controller: ClassifierController;

  beforeEach(() => {
    classifier = { runBatch: jest.fn() };
    controller = new ClassifierController(
      classifier as unknown as ConversationClassifierService,
    );
  });

  it('runs the batch and returns the processed count', async () => {
    classifier.runBatch.mockResolvedValue(7);

    const result = await controller.run();

    expect(classifier.runBatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 7 });
  });

  it('propagates errors from the batch (cron sees a non-200)', async () => {
    classifier.runBatch.mockRejectedValue(new Error('boom'));

    await expect(controller.run()).rejects.toThrow('boom');
  });
});
