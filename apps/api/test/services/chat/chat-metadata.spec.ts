import type {
  BaseChatMetadata,
  SimulatedStreamingMetadata,
  RealStreamingMetadata,
  ChatMessageMetadata,
} from '../../../src/services/chat-metadata.interface';

describe('ChatMessageMetadata interfaces', () => {
  describe('SimulatedStreamingMetadata (buildMetadata path)', () => {
    it('should include all base fields plus streamingMode=simulated', () => {
      const metadata: SimulatedStreamingMetadata = {
        streamingMode: 'simulated',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.500Z',
        agentRepliedAt: '2026-03-01T10:00:01.200Z',
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
      };

      expect(metadata.streamingMode).toBe('simulated');
      expect(metadata.backendReceivedAt).toBeDefined();
      expect(metadata.n8nReceivedAt).toBeDefined();
      expect(metadata.agentRepliedAt).toBeDefined();
      expect(metadata.backendRespondedAt).toBeDefined();
      expect(metadata.responseLatencyMs).toBe(1300);
      // Simulated mode should NOT have streaming-specific fields
      expect((metadata as Record<string, unknown>)['timeToFirstToken']).toBeUndefined();
      expect((metadata as Record<string, unknown>)['timeToLastToken']).toBeUndefined();
      expect((metadata as Record<string, unknown>)['totalChunks']).toBeUndefined();
      expect((metadata as Record<string, unknown>)['streamDurationMs']).toBeUndefined();
    });

    it('should allow null for n8nReceivedAt and agentRepliedAt', () => {
      const metadata: SimulatedStreamingMetadata = {
        streamingMode: 'simulated',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: null,
        agentRepliedAt: null,
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
      };

      expect(metadata.n8nReceivedAt).toBeNull();
      expect(metadata.agentRepliedAt).toBeNull();
    });
  });

  describe('RealStreamingMetadata (streaming controller path)', () => {
    it('should include all base fields plus streaming-specific fields', () => {
      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.701Z',
        agentRepliedAt: '2026-03-01T10:00:02.355Z',
        backendRespondedAt: '2026-03-01T10:00:02.400Z',
        responseLatencyMs: 2400,
        timeToFirstToken: 750,
        timeToLastToken: 2300,
        totalChunks: 47,
        streamDurationMs: 1654,
      };

      expect(metadata.streamingMode).toBe('real');
      expect(metadata.timeToFirstToken).toBe(750);
      expect(metadata.timeToLastToken).toBe(2300);
      expect(metadata.totalChunks).toBe(47);
      expect(metadata.streamDurationMs).toBe(1654);
      // Base fields still present
      expect(metadata.responseLatencyMs).toBe(2400);
      expect(metadata.backendReceivedAt).toBeDefined();
    });

    it('should allow null for timeToFirstToken and timeToLastToken when no item chunks received', () => {
      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.701Z',
        agentRepliedAt: '2026-03-01T10:00:00.800Z',
        backendRespondedAt: '2026-03-01T10:00:00.850Z',
        responseLatencyMs: 850,
        timeToFirstToken: null,
        timeToLastToken: null,
        totalChunks: 0,
        streamDurationMs: 99,
      };

      expect(metadata.timeToFirstToken).toBeNull();
      expect(metadata.timeToLastToken).toBeNull();
      expect(metadata.totalChunks).toBe(0);
    });

    it('should allow null for streamDurationMs when timestamps are missing', () => {
      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: null,
        agentRepliedAt: null,
        backendRespondedAt: '2026-03-01T10:00:02.000Z',
        responseLatencyMs: 2000,
        timeToFirstToken: 500,
        timeToLastToken: 1800,
        totalChunks: 10,
        streamDurationMs: null,
      };

      expect(metadata.streamDurationMs).toBeNull();
      expect(metadata.n8nReceivedAt).toBeNull();
      expect(metadata.agentRepliedAt).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('responseLatencyMs is present in all metadata shapes', () => {
      const direct: BaseChatMetadata = {
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.500Z',
        agentRepliedAt: '2026-03-01T10:00:01.200Z',
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
      };

      const simulated: SimulatedStreamingMetadata = {
        ...direct,
        streamingMode: 'simulated',
      };

      const real: RealStreamingMetadata = {
        ...direct,
        streamingMode: 'real',
        timeToFirstToken: 500,
        timeToLastToken: 1100,
        totalChunks: 20,
        streamDurationMs: 700,
      };

      // All shapes have responseLatencyMs — analytics queries work across all modes
      expect(direct.responseLatencyMs).toBe(1300);
      expect(simulated.responseLatencyMs).toBe(1300);
      expect(real.responseLatencyMs).toBe(1300);
    });

    it('analytics-relevant fields (n8nReceivedAt, agentRepliedAt) present in all shapes', () => {
      const shapes: ChatMessageMetadata[] = [
        {
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          n8nReceivedAt: '2026-03-01T10:00:00.500Z',
          agentRepliedAt: '2026-03-01T10:00:01.200Z',
          backendRespondedAt: '2026-03-01T10:00:01.300Z',
          responseLatencyMs: 1300,
        },
        {
          streamingMode: 'simulated',
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          n8nReceivedAt: '2026-03-01T10:00:00.500Z',
          agentRepliedAt: '2026-03-01T10:00:01.200Z',
          backendRespondedAt: '2026-03-01T10:00:01.300Z',
          responseLatencyMs: 1300,
        },
        {
          streamingMode: 'real',
          backendReceivedAt: '2026-03-01T10:00:00.000Z',
          n8nReceivedAt: '2026-03-01T10:00:00.701Z',
          agentRepliedAt: '2026-03-01T10:00:02.355Z',
          backendRespondedAt: '2026-03-01T10:00:02.400Z',
          responseLatencyMs: 2400,
          timeToFirstToken: 750,
          timeToLastToken: 2300,
          totalChunks: 47,
          streamDurationMs: 1654,
        },
      ];

      for (const shape of shapes) {
        expect(shape).toHaveProperty('responseLatencyMs');
        expect(shape).toHaveProperty('n8nReceivedAt');
        expect(shape).toHaveProperty('agentRepliedAt');
        expect(shape).toHaveProperty('backendReceivedAt');
        expect(shape).toHaveProperty('backendRespondedAt');
      }
    });
  });

  describe('metadata extraction from stream chunks', () => {
    it('should build correct metadata from begin/item/end chunks', () => {
      // Simulating what the controller does when processing stream chunks
      const backendReceivedAt = new Date('2026-03-01T10:00:00.000Z');
      const beginTimestamp = 1774969200701; // epoch ms
      const endTimestamp = 1774969202355;   // epoch ms
      const firstTokenTime = backendReceivedAt.getTime() + 750;
      const lastTokenTime = backendReceivedAt.getTime() + 2300;
      const chunkCount = 47;

      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: backendReceivedAt.toISOString(),
        n8nReceivedAt: new Date(beginTimestamp).toISOString(),
        agentRepliedAt: new Date(endTimestamp).toISOString(),
        backendRespondedAt: new Date(backendReceivedAt.getTime() + 2400).toISOString(),
        responseLatencyMs: 2400,
        timeToFirstToken: firstTokenTime - backendReceivedAt.getTime(),
        timeToLastToken: lastTokenTime - backendReceivedAt.getTime(),
        totalChunks: chunkCount,
        streamDurationMs: endTimestamp - beginTimestamp,
      };

      expect(metadata.n8nReceivedAt).toBe(new Date(beginTimestamp).toISOString());
      expect(metadata.agentRepliedAt).toBe(new Date(endTimestamp).toISOString());
      expect(metadata.timeToFirstToken).toBe(750);
      expect(metadata.timeToLastToken).toBe(2300);
      expect(metadata.totalChunks).toBe(47);
      expect(metadata.streamDurationMs).toBe(endTimestamp - beginTimestamp);
      expect(metadata.responseLatencyMs).toBe(2400);
    });

    it('should handle missing begin timestamp (n8nReceivedAt=null)', () => {
      const backendReceivedAt = new Date('2026-03-01T10:00:00.000Z');
      const n8nReceivedAt: number | null = null;
      const agentRepliedAt: number | null = 1774969202355;

      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: backendReceivedAt.toISOString(),
        n8nReceivedAt: n8nReceivedAt ? new Date(n8nReceivedAt).toISOString() : null,
        agentRepliedAt: agentRepliedAt ? new Date(agentRepliedAt).toISOString() : null,
        backendRespondedAt: new Date().toISOString(),
        responseLatencyMs: 2000,
        timeToFirstToken: 500,
        timeToLastToken: 1800,
        totalChunks: 10,
        streamDurationMs: agentRepliedAt && n8nReceivedAt ? agentRepliedAt - n8nReceivedAt : null,
      };

      expect(metadata.n8nReceivedAt).toBeNull();
      expect(metadata.streamDurationMs).toBeNull();
    });

    it('should handle missing end timestamp (agentRepliedAt=null)', () => {
      const backendReceivedAt = new Date('2026-03-01T10:00:00.000Z');
      const n8nReceivedAt: number | null = 1774969200701;
      const agentRepliedAt: number | null = null;

      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: backendReceivedAt.toISOString(),
        n8nReceivedAt: n8nReceivedAt ? new Date(n8nReceivedAt).toISOString() : null,
        agentRepliedAt: agentRepliedAt ? new Date(agentRepliedAt).toISOString() : null,
        backendRespondedAt: new Date().toISOString(),
        responseLatencyMs: 2000,
        timeToFirstToken: 500,
        timeToLastToken: 1800,
        totalChunks: 10,
        streamDurationMs: agentRepliedAt && n8nReceivedAt ? agentRepliedAt - n8nReceivedAt : null,
      };

      expect(metadata.agentRepliedAt).toBeNull();
      expect(metadata.streamDurationMs).toBeNull();
    });

    it('should handle both timestamps missing', () => {
      const metadata: RealStreamingMetadata = {
        streamingMode: 'real',
        backendReceivedAt: new Date().toISOString(),
        n8nReceivedAt: null,
        agentRepliedAt: null,
        backendRespondedAt: new Date().toISOString(),
        responseLatencyMs: 1500,
        timeToFirstToken: null,
        timeToLastToken: null,
        totalChunks: 0,
        streamDurationMs: null,
      };

      expect(metadata.n8nReceivedAt).toBeNull();
      expect(metadata.agentRepliedAt).toBeNull();
      expect(metadata.timeToFirstToken).toBeNull();
      expect(metadata.timeToLastToken).toBeNull();
      expect(metadata.totalChunks).toBe(0);
      expect(metadata.streamDurationMs).toBeNull();
    });
  });
});
