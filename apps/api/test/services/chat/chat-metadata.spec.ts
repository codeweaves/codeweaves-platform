import type { ChatMessageMetadata } from '../../../src/services/chat-metadata.interface';

describe('ChatMessageMetadata (unified interface)', () => {
  describe('baseline fields (required in every mode)', () => {
    it('accepts a simulated-mode record', () => {
      const metadata: ChatMessageMetadata = {
        streamingMode: 'simulated',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
        n8nReceivedAt: '2026-03-01T10:00:00.500Z',
        agentRepliedAt: '2026-03-01T10:00:01.200Z',
        timeToFirstToken: null,
        timeToLastToken: null,
        totalChunks: null,
        streamDurationMs: null,
      };

      expect(metadata.streamingMode).toBe('simulated');
      expect(metadata.responseLatencyMs).toBe(1300);
    });

    it('accepts a real-streaming (n8n) record with per-token timings', () => {
      const metadata: ChatMessageMetadata = {
        streamingMode: 'real',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        backendRespondedAt: '2026-03-01T10:00:02.400Z',
        responseLatencyMs: 2400,
        n8nReceivedAt: '2026-03-01T10:00:00.701Z',
        agentRepliedAt: '2026-03-01T10:00:02.355Z',
        timeToFirstToken: 750,
        timeToLastToken: 2300,
        totalChunks: 47,
        streamDurationMs: 1654,
      };

      expect(metadata.streamingMode).toBe('real');
      expect(metadata.timeToFirstToken).toBe(750);
      expect(metadata.totalChunks).toBe(47);
    });

    it('accepts a direct-mode record with native observability fields', () => {
      const metadata: ChatMessageMetadata = {
        streamingMode: 'direct',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        backendRespondedAt: '2026-03-01T10:00:02.000Z',
        responseLatencyMs: 2000,
        timeToFirstToken: 1100,
        timeToLastToken: 1950,
        totalChunks: 60,
        streamDurationMs: 850,
        traceId: 't_abc123',
        model: 'openai:gpt-4.1-mini',
        cost: null,
        inputTokens: 7800,
        outputTokens: 55,
        totalTokens: 7855,
        cachedInputTokens: 7680,
        reasoningTokens: 0,
        finishReason: 'stop',
        historyCount: 4,
        historyTruncated: false,
      };

      expect(metadata.streamingMode).toBe('direct');
      expect(metadata.cachedInputTokens).toBe(7680);
      expect(metadata.traceId).toBe('t_abc123');
    });
  });

  describe('analytics-relevant fields are present across all routing modes', () => {
    it('responseLatencyMs + streamingMode are always populated', () => {
      const shapes: ChatMessageMetadata[] = [
        {
          streamingMode: 'simulated',
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          backendRespondedAt: '2026-03-01T10:00:01.300Z',
          responseLatencyMs: 1300,
          n8nReceivedAt: '2026-03-01T10:00:00.500Z',
          agentRepliedAt: '2026-03-01T10:00:01.200Z',
        },
        {
          streamingMode: 'real',
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          backendRespondedAt: '2026-03-01T10:00:02.400Z',
          responseLatencyMs: 2400,
          timeToFirstToken: 750,
          totalChunks: 47,
        },
        {
          streamingMode: 'direct',
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          backendRespondedAt: '2026-03-01T10:00:02.000Z',
          responseLatencyMs: 2000,
          timeToFirstToken: 1100,
          inputTokens: 7800,
          cachedInputTokens: 7680,
        },
      ];

      for (const shape of shapes) {
        expect(shape).toHaveProperty('streamingMode');
        expect(shape).toHaveProperty('responseLatencyMs');
        expect(shape).toHaveProperty('backendReceivedAt');
        expect(shape).toHaveProperty('backendRespondedAt');
      }
    });
  });
});
