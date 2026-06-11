import { Test, TestingModule } from '@nestjs/testing';
import { MessageMetricsService } from '../../../src/services/message-metrics.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('MessageMetricsService', () => {
  let service: MessageMetricsService;

  const mockPrisma = {
    chatMessageMetrics: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageMetricsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<MessageMetricsService>(MessageMetricsService);
    jest.clearAllMocks();
  });

  describe('fromMetadata — alias reconciliation', () => {
    it('coalesces TTFT across timeToFirstToken | llmTtftMs | ttftMs (in that precedence)', () => {
      expect(service.fromMetadata({ timeToFirstToken: 120 }).timeToFirstTokenMs).toBe(120);
      expect(service.fromMetadata({ llmTtftMs: 200 }).timeToFirstTokenMs).toBe(200);
      expect(service.fromMetadata({ ttftMs: 300 }).timeToFirstTokenMs).toBe(300);
      expect(service.fromMetadata({ timeToFirstToken: 1, llmTtftMs: 2, ttftMs: 3 }).timeToFirstTokenMs).toBe(1);
    });

    it('coalesces TTS latency across averageTtsLatencyMs | ttsLatencyMs', () => {
      expect(service.fromMetadata({ averageTtsLatencyMs: 1500 }).ttsLatencyMs).toBe(1500);
      expect(service.fromMetadata({ ttsLatencyMs: 900 }).ttsLatencyMs).toBe(900);
      expect(service.fromMetadata({ averageTtsLatencyMs: 1, ttsLatencyMs: 2 }).ttsLatencyMs).toBe(1);
    });

    it('maps responseLatencyMs (received→sent) and llmLatencyMs (model time) straight through', () => {
      // Every channel — including WhatsApp now — sends both distinctly.
      const wa = service.fromMetadata({ waInboundId: 'wamid.X', responseLatencyMs: 800, llmLatencyMs: 650 });
      expect(wa.responseLatencyMs).toBe(800);
      expect(wa.llmLatencyMs).toBe(650);
      expect(service.fromMetadata({ responseLatencyMs: 500 }).responseLatencyMs).toBe(500);
    });

    it('falls back to legacy latencyMs for llmLatencyMs (dev path)', () => {
      expect(service.fromMetadata({ latencyMs: 1200 }).llmLatencyMs).toBe(1200);
    });

    it('renames timeToFirstChunkMs -> timeToFirstAudioMs and totalLatencyMs -> voiceTotalLatencyMs', () => {
      const m = service.fromMetadata({ timeToFirstChunkMs: 400, totalLatencyMs: 3000 });
      expect(m.timeToFirstAudioMs).toBe(400);
      expect(m.voiceTotalLatencyMs).toBe(3000);
    });

    it('maps error -> errored (bool) and cost -> costUsd (decimal, no rounding)', () => {
      expect(service.fromMetadata({ error: true }).errored).toBe(true);
      expect(service.fromMetadata({ cost: 0.0023 }).costUsd).toBeCloseTo(0.0023);
    });

    it('rounds integer columns and drops non-numeric junk', () => {
      expect(service.fromMetadata({ responseLatencyMs: 12.6 }).responseLatencyMs).toBe(13);
      expect(service.fromMetadata({ responseLatencyMs: 'abc' }).responseLatencyMs).toBeNull();
    });

    it('only accepts text|voice for inputType', () => {
      expect(service.fromMetadata({ inputType: 'voice' }).inputType).toBe('voice');
      expect(service.fromMetadata({ inputType: 'weird' }).inputType).toBeNull();
    });

    it('handles null/undefined metadata without throwing', () => {
      expect(service.fromMetadata(null).timeToFirstTokenMs).toBeNull();
      expect(service.fromMetadata(undefined).model).toBeNull();
    });
  });

  describe('record', () => {
    it('upserts keyed on messageId, stripping undefined fields', async () => {
      mockPrisma.chatMessageMetrics.upsert.mockResolvedValue({});
      const createdAt = new Date('2026-06-11T00:00:00.000Z');
      await service.record('msg-1', createdAt, { responseLatencyMs: 500, model: 'openai:gpt' });
      expect(mockPrisma.chatMessageMetrics.upsert).toHaveBeenCalledWith({
        where: { messageId: 'msg-1' },
        create: { messageId: 'msg-1', createdAt, responseLatencyMs: 500, model: 'openai:gpt' },
        update: { responseLatencyMs: 500, model: 'openai:gpt' },
      });
    });

    it('never throws when the upsert fails (best-effort, must not break the chat path)', async () => {
      mockPrisma.chatMessageMetrics.upsert.mockRejectedValue(new Error('db down'));
      await expect(service.record('msg-2', new Date('2026-06-11T00:00:00.000Z'), { responseLatencyMs: 1 })).resolves.toBeUndefined();
    });
  });
});
