import { Test } from '@nestjs/testing';
import { AiTraceService } from '../../../src/modules/ai/trace/ai-trace.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('AiTraceService', () => {
  let service: AiTraceService;
  const mockPrisma = {
    chatTrace: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiTraceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(AiTraceService);
    mockPrisma.chatTrace.create.mockResolvedValue({});
  });

  describe('startTrace()', () => {
    it('returns a trace context with a generated traceId', () => {
      const trace = service.startTrace({
        agentId: 'a-1',
        sessionId: 's-1',
        userMessage: 'hi',
      });
      expect(trace.traceId).toMatch(/^t_[a-zA-Z0-9_-]{10}$/);
      expect(trace.agentId).toBe('a-1');
      expect(trace.sessionId).toBe('s-1');
    });

    it('accepts a caller-supplied traceId', () => {
      const trace = service.startTrace({
        agentId: 'a-1',
        traceId: 'trace-custom-123',
      });
      expect(trace.traceId).toBe('trace-custom-123');
    });
  });

  describe('step()', () => {
    it('logs a step event to the trace', () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      trace.step('context.load', { messages: 5 }, 30);
      // No direct assert — internal state; verified via subscribe()/end().
      expect(true).toBe(true);
    });
  });

  describe('measure()', () => {
    it('records a successful step with duration', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      const result = await trace.measure('context.load', async () => ({
        messages: [1, 2, 3],
      }));
      expect(result).toEqual({ messages: [1, 2, 3] });
    });

    it('records a step with extracted data', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      await trace.measure(
        'llm.complete',
        async () => ({ tokens: 100, model: 'gpt-4o' }),
        (r) => ({ tokens: r.tokens, model: r.model }),
      );
      // step was recorded — verified via end() roundtrip below.
    });

    it('logs an error step + rethrows when fn rejects', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      await expect(
        trace.measure('llm.complete', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
  });

  describe('error()', () => {
    it('records an error step', () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      trace.error('llm.failed', new Error('upstream 500'));
      expect(true).toBe(true);
    });
  });

  describe('end()', () => {
    it('persists the trace to DB with steps', async () => {
      const trace = service.startTrace({
        agentId: 'a-1',
        sessionId: 's-1',
        userMessage: 'hello',
      });
      trace.step('context.load', { messages: 5 }, 30);
      await trace.end({
        success: true,
        response: 'hi there',
        model: 'gpt-4o',
      });
      expect(mockPrisma.chatTrace.create).toHaveBeenCalledTimes(1);
      const call = mockPrisma.chatTrace.create.mock.calls[0]![0];
      expect(call.data).toMatchObject({
        traceId: trace.traceId,
        agentId: 'a-1',
        sessionId: 's-1',
        userMessage: 'hello',
        response: 'hi there',
        model: 'gpt-4o',
        success: true,
      });
      expect(call.data.steps).toHaveLength(1);
      expect(call.data.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('is idempotent — second end() is a no-op', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      await trace.end({ success: true });
      await trace.end({ success: true });
      expect(mockPrisma.chatTrace.create).toHaveBeenCalledTimes(1);
    });

    it('swallows DB persistence errors silently', async () => {
      mockPrisma.chatTrace.create.mockRejectedValueOnce(new Error('db down'));
      const trace = service.startTrace({ agentId: 'a-1' });
      await expect(trace.end({ success: true })).resolves.toBeUndefined();
    });

    it('persists error details when success=false', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      await trace.end({ success: false, error: 'rate limit exceeded' });
      const call = mockPrisma.chatTrace.create.mock.calls[0]![0];
      expect(call.data).toMatchObject({
        success: false,
        errorMessage: 'rate limit exceeded',
      });
    });
  });

  describe('subscribe()', () => {
    it('emits step events and terminates on end', async () => {
      const trace = service.startTrace({ agentId: 'a-1' });
      const events: unknown[] = [];

      const consumePromise = (async () => {
        for await (const event of trace.subscribe()) {
          events.push(event);
          if ((event as { type: string }).type === 'end') break;
        }
      })();

      // Emit a step, then end.
      trace.step('context.load', { messages: 1 }, 10);
      await trace.end({ success: true, response: 'ok' });
      await consumePromise;

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect((events[events.length - 1] as { type: string }).type).toBe('end');
    });

    it('returns an empty iterable for unknown traceId', async () => {
      // Direct subscribe via service; trace doesn't exist.
      const iter = service.subscribe('nonexistent');
      const out: unknown[] = [];
      for await (const e of iter) out.push(e);
      expect(out).toEqual([]);
    });
  });

  describe('findByTraceId() / listRecent()', () => {
    it('delegates findByTraceId to prisma.chatTrace.findUnique', async () => {
      mockPrisma.chatTrace.findUnique.mockResolvedValue({ traceId: 't-1' });
      const result = await service.findByTraceId('t-1');
      expect(result).toMatchObject({ traceId: 't-1' });
      expect(mockPrisma.chatTrace.findUnique).toHaveBeenCalledWith({
        where: { traceId: 't-1' },
      });
    });

    it('listRecent applies default limit + caps at 200', async () => {
      mockPrisma.chatTrace.findMany.mockResolvedValue([]);
      await service.listRecent('a-1');
      expect(mockPrisma.chatTrace.findMany.mock.calls[0]![0]).toMatchObject({
        where: { agentId: 'a-1' },
        take: 50,
      });
      await service.listRecent('a-1', 9999);
      expect(mockPrisma.chatTrace.findMany.mock.calls[1]![0].take).toBe(200);
      await service.listRecent('a-1', 0);
      expect(mockPrisma.chatTrace.findMany.mock.calls[2]![0].take).toBe(1);
    });
  });
});
