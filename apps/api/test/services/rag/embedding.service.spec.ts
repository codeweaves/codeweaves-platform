import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

// Mock the AI SDK's embed/embedMany at module level (same pattern as
// llm.service.spec).
jest.mock('ai', () => ({
  embed: jest.fn(),
  embedMany: jest.fn(),
}));
import { embed, embedMany } from 'ai';

import { EmbeddingService } from '../../../src/modules/rag/embedding.service';
import { AiSdkService } from '../../../src/modules/ai/ai-sdk.service';
import { UsageTrackingService } from '../../../src/modules/ai/usage-tracking.service';

const mockedEmbed = embed as jest.MockedFunction<typeof embed>;
const mockedEmbedMany = embedMany as jest.MockedFunction<typeof embedMany>;

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  const mockAiSdk = { getEmbeddingModel: jest.fn() };
  const mockUsage = { record: jest.fn() };
  const configValues: Record<string, string | undefined> = {};
  const mockConfig = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const tracking = { organizationId: 'org-1', agentId: 'agent-1' };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete configValues.EMBEDDING_MODEL;
    mockConfig.get.mockImplementation((key: string) => configValues[key]);
    mockAiSdk.getEmbeddingModel.mockReturnValue({ modelId: 'fake-model' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: AiSdkService, useValue: mockAiSdk },
        { provide: ConfigService, useValue: mockConfig },
        { provide: UsageTrackingService, useValue: mockUsage },
      ],
    }).compile();
    service = moduleRef.get(EmbeddingService);
  });

  describe('getModelId()', () => {
    it('defaults to text-embedding-3-small', () => {
      expect(service.getModelId()).toBe('openai:text-embedding-3-small');
    });

    it('honours the EMBEDDING_MODEL env override', () => {
      configValues.EMBEDDING_MODEL = 'gemini:text-embedding-004';
      expect(service.getModelId()).toBe('gemini:text-embedding-004');
    });
  });

  describe('embedTexts()', () => {
    it('returns [] without any API call for empty input', async () => {
      expect(await service.embedTexts([], tracking)).toEqual([]);
      expect(mockedEmbedMany).not.toHaveBeenCalled();
      expect(mockUsage.record).not.toHaveBeenCalled();
    });

    it('embeds one batch and records usage as feature=embedding', async () => {
      mockedEmbedMany.mockResolvedValue({
        embeddings: [[0.1], [0.2]],
        usage: { tokens: 42 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const vectors = await service.embedTexts(['a', 'b'], tracking);
      expect(vectors).toEqual([[0.1], [0.2]]);
      expect(mockedEmbedMany).toHaveBeenCalledTimes(1);
      expect(mockUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          agentId: 'agent-1',
          feature: 'embedding',
          usage: { inputTokens: 42, outputTokens: 0, totalTokens: 42 },
        }),
      );
    });

    it('splits large inputs into batches of 96 preserving order', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `text-${i}`);
      mockedEmbedMany.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async ({ values }: any) => ({
          embeddings: (values as string[]).map((v) => [Number(v.split('-')[1])]),
          usage: { tokens: values.length },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );

      const vectors = await service.embedTexts(texts, tracking);
      expect(mockedEmbedMany).toHaveBeenCalledTimes(2); // 96 + 4
      expect(vectors).toHaveLength(100);
      expect(vectors[0]).toEqual([0]);
      expect(vectors[99]).toEqual([99]);
      // Token counts summed across batches into ONE usage record.
      expect(mockUsage.record).toHaveBeenCalledTimes(1);
      expect(mockUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: expect.objectContaining({ totalTokens: 100 }),
        }),
      );
    });

    it('propagates embedding API failures (caller handles status)', async () => {
      mockedEmbedMany.mockRejectedValue(new Error('429 rate limit'));
      await expect(service.embedTexts(['a'], tracking)).rejects.toThrow(
        '429 rate limit',
      );
    });
  });

  describe('embedQuery()', () => {
    it('embeds a single query and records usage as feature=rag-query', async () => {
      mockedEmbed.mockResolvedValue({
        embedding: [0.5, 0.6],
        usage: { tokens: 7 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const vector = await service.embedQuery('refund policy?', {
        ...tracking,
        sessionId: 'sess-1',
      });
      expect(vector).toEqual([0.5, 0.6]);
      expect(mockUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'rag-query',
          sessionId: 'sess-1',
          usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7 },
        }),
      );
    });
  });
});
