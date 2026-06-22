import { ClassifierController } from '../../../src/controllers/internal/classifier.controller';
import type { ConversationClassifierService } from '../../../src/services/conversation-classifier.service';

describe('ClassifierController', () => {
  let classifier: { triggerBatch: jest.Mock };
  let controller: ClassifierController;

  beforeEach(() => {
    classifier = { triggerBatch: jest.fn() };
    controller = new ClassifierController(
      classifier as unknown as ConversationClassifierService,
    );
  });

  it('triggers a background batch and acks immediately', () => {
    classifier.triggerBatch.mockReturnValue(true);

    const result = controller.run();

    expect(classifier.triggerBatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ started: true });
  });

  it('reports started=false when a pass is already running', () => {
    classifier.triggerBatch.mockReturnValue(false);

    expect(controller.run()).toEqual({ started: false });
  });
});
