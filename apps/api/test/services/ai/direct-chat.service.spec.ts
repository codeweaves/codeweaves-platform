import { Test } from '@nestjs/testing';
import type { Agent } from '@prisma/client';
import { DirectChatService } from '../../../src/modules/ai/direct-chat.service';
import { AiSdkService } from '../../../src/modules/ai/ai-sdk.service';
import { LlmService } from '../../../src/modules/ai/llm.service';
import { ContextAssemblyService } from '../../../src/modules/ai/context-assembly.service';
import { HybridContextStrategy } from '../../../src/modules/ai/strategies/hybrid-context.strategy';
import { PromptTemplateService } from '../../../src/modules/ai/prompt-template.service';
import { AiTraceService } from '../../../src/modules/ai/trace/ai-trace.service';
import { UsageTrackingService } from '../../../src/modules/ai/usage-tracking.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { DataExtractionService } from '../../../src/services/data-extraction.service';
import { RagRetrievalService } from '../../../src/modules/rag/rag-retrieval.service';
import { AgentToolsService } from '../../../src/modules/integrations/agent-tools.service';
import { RagLoggerService } from '../../../src/common/logger/rag.logger';
import type { LlmStreamChunk } from '../../../src/modules/ai/interfaces/llm.interfaces';

describe('DirectChatService', () => {
  let service: DirectChatService;

  const mockAiSdk = { getDefaultModel: jest.fn().mockReturnValue('default-model') };
  const mockLlm = {
    generateCompletion: jest.fn(),
    streamCompletion: jest.fn(),
  };
  const mockContext = { assemble: jest.fn() };
  const mockHybrid = { assemble: jest.fn() };
  const mockPromptTemplate = { resolve: jest.fn((s: string) => s) };
  const mockTrace = {
    startTrace: jest.fn(),
  };
  const mockUsage = { record: jest.fn() };
  const mockPrisma = {};
  const mockCache = {
    getAgentWithKnowledge: jest.fn(),
  };
  const mockDataExtractionService = { scheduleExtraction: jest.fn() };
  // RAG defaults: no indexed documents, so send()/stream() behave exactly as
  // pre-RAG (dedicated RAG-path tests flip these).
  const mockRagRetrieval = {
    hasReadyDocuments: jest.fn().mockResolvedValue(false),
    retrieve: jest.fn(),
  };
  // Integrations default: no connected tools.
  const mockAgentTools = { buildToolsForAgent: jest.fn().mockResolvedValue(null) };
  const mockRagLogger = { logRetrievalFailed: jest.fn().mockResolvedValue(undefined) };

  const traceContext = {
    traceId: 'trace-1',
    step: jest.fn(),
    measure: jest.fn(),
    error: jest.fn(),
    end: jest.fn(),
    subscribe: jest.fn(),
  };

  const mockAgent: Agent = {
    id: 'agent-1',
    organizationId: 'org-1',
    name: 'Test Agent',
    systemPrompt: 'You are helpful.',
    aiConfig: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const baseContext = {
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    historyCount: 0,
    estimatedTokens: 50,
    truncated: false,
    droppedCount: 0,
    olderMessagesExist: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTrace.startTrace.mockReturnValue(traceContext);
    traceContext.measure.mockImplementation(
      async (_name: string, fn: () => Promise<unknown>) => fn(),
    );
    traceContext.end.mockResolvedValue(undefined);
    mockPromptTemplate.resolve.mockImplementation((s: string) => s);
    mockContext.assemble.mockResolvedValue(baseContext);
    mockHybrid.assemble.mockResolvedValue(baseContext);
    mockCache.getAgentWithKnowledge.mockResolvedValue({ knowledge: null });

    const moduleRef = await Test.createTestingModule({
      providers: [
        DirectChatService,
        { provide: AiSdkService, useValue: mockAiSdk },
        { provide: LlmService, useValue: mockLlm },
        { provide: ContextAssemblyService, useValue: mockContext },
        { provide: HybridContextStrategy, useValue: mockHybrid },
        { provide: PromptTemplateService, useValue: mockPromptTemplate },
        { provide: AiTraceService, useValue: mockTrace },
        { provide: UsageTrackingService, useValue: mockUsage },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
        {
          provide: DataExtractionService,
          useValue: mockDataExtractionService,
        },
        { provide: RagRetrievalService, useValue: mockRagRetrieval },
        { provide: AgentToolsService, useValue: mockAgentTools },
        { provide: RagLoggerService, useValue: mockRagLogger },
      ],
    }).compile();
    service = moduleRef.get(DirectChatService);
    mockRagRetrieval.hasReadyDocuments.mockResolvedValue(false);
    mockAgentTools.buildToolsForAgent.mockResolvedValue(null);
  });

  describe('send() — non-streaming', () => {
    it('returns the full result and records usage on success', async () => {
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'Hello back',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 0,
          reasoningTokens: undefined,
        },
        cost: 0.0001,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        latencyMs: 200,
        retryCount: 0,
      });

      const result = await service.send({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        externalSessionId: 'ext-1',
        newUserMessage: 'Hello',
      });

      expect(result.text).toBe('Hello back');
      expect(result.traceId).toBe('trace-1');
      expect(result.ttftMs).toBeNull(); // non-streaming
      expect(mockUsage.record).toHaveBeenCalledTimes(1);
      expect(traceContext.end).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    it('appends knowledge content to system prompt when available', async () => {
      mockCache.getAgentWithKnowledge.mockResolvedValue({
        knowledge: { content: 'KB content here', contentTokens: 100 },
      });
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'Answer using KB',
        usage: {
          inputTokens: 50,
          outputTokens: 5,
          totalTokens: 55,
          cachedInputTokens: 0,
          reasoningTokens: undefined,
        },
        cost: 0.0002,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        latencyMs: 200,
        retryCount: 0,
      });

      await service.send({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      });

      const callArg = mockLlm.generateCompletion.mock.calls[0]![0];
      expect(callArg.systemPrompt).toContain('You are helpful.');
      expect(callArg.systemPrompt).toContain('[REFERENCE KNOWLEDGE]');
      expect(callArg.systemPrompt).toContain('KB content here');
    });

    it('uses HybridContextStrategy when agent config sets contextStrategy=hybrid', async () => {
      const hybridAgent = {
        ...mockAgent,
        aiConfig: { contextStrategy: 'hybrid' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'ok',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cachedInputTokens: 0,
          reasoningTokens: undefined,
        },
        cost: 0,
        model: 'x',
        finishReason: 'stop',
        latencyMs: 100,
        retryCount: 0,
      });
      await service.send({
        agent: hybridAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      });
      expect(mockHybrid.assemble).toHaveBeenCalled();
      expect(mockContext.assemble).not.toHaveBeenCalled();
    });

    it('marks trace as failed on LLM error and rethrows', async () => {
      mockLlm.generateCompletion.mockRejectedValue(new Error('LLM down'));
      await expect(
        service.send({
          agent: mockAgent,
          chatSessionId: 'sess-1',
          newUserMessage: 'Hi',
        }),
      ).rejects.toThrow('LLM down');
      expect(traceContext.end).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'LLM down' }),
      );
    });
  });

  describe('stream() — streaming', () => {
    async function* tokenStream(
      chunks: LlmStreamChunk[],
    ): AsyncIterable<LlmStreamChunk> {
      for (const c of chunks) yield c;
    }

    it('yields trace + text-delta + finish chunks in order', async () => {
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          { type: 'text-delta', content: 'Hi' },
          { type: 'text-delta', content: ' there' },
          {
            type: 'finish',
            model: 'gpt-4o-mini',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              cachedInputTokens: 0,
              reasoningTokens: undefined,
            },
            cost: 0.0001,
            finishReason: 'stop',
            ttftMs: 230,
            totalMs: 510,
          },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hello',
      })) {
        chunks.push(chunk);
      }

      const types = chunks.map((c) => (c as { type: string }).type);
      expect(types).toContain('trace');
      expect(types).toContain('text-delta');
      expect(types[types.length - 1]).toBe('finish');

      const finishChunk = chunks[chunks.length - 1] as {
        type: 'finish';
        result: { text: string; ttftMs: number };
      };
      expect(finishChunk.result.text).toBe('Hi there');
      expect(finishChunk.result.ttftMs).toBe(230);
      expect(mockUsage.record).toHaveBeenCalledTimes(1);
    });

    it('runs RAG when documents are indexed: steps + system block + citations', async () => {
      mockRagRetrieval.hasReadyDocuments.mockResolvedValue(true);
      mockRagRetrieval.retrieve.mockResolvedValue([
        {
          chunkId: 'c1',
          documentId: 'doc-1',
          documentName: 'policies.pdf',
          sourceType: 'FILE',
          sourceUrl: null,
          content: 'Refunds are available within 30 days.',
          tokenCount: 10,
          score: 0.9,
          metadata: {},
        },
      ]);
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          { type: 'text-delta', content: 'Refunds take 30 days [1].' },
          {
            type: 'finish',
            model: 'gpt-4o-mini',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            cost: null,
            finishReason: 'stop',
            ttftMs: 100,
            totalMs: 300,
          },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'What is the refund policy?',
      })) {
        chunks.push(chunk);
      }

      // Step lifecycle: active while searching, done with the document names.
      const steps = chunks.filter(
        (c) => (c as { type: string }).type === 'step',
      ) as Array<{ step: { id: string; status: string; label: string } }>;
      expect(steps[0]!.step).toMatchObject({ id: 'rag', status: 'active' });
      expect(steps[1]!.step).toMatchObject({
        id: 'rag',
        status: 'done',
        label: 'Read policies.pdf',
      });

      // Retrieved context injected into the system prompt.
      const llmReq = mockLlm.streamCompletion.mock.calls[0][0] as {
        systemPrompt: string;
      };
      expect(llmReq.systemPrompt).toContain('[RETRIEVED KNOWLEDGE]');
      expect(llmReq.systemPrompt).toContain('policies.pdf');

      // Citations resolved from the [1] marker.
      const finish = chunks[chunks.length - 1] as {
        result: { citations: Array<{ documentName: string }> };
      };
      expect(finish.result.citations).toHaveLength(1);
      expect(finish.result.citations[0]!.documentName).toBe('policies.pdf');
    });

    it('degrades gracefully when retrieval fails (error step, chat continues)', async () => {
      mockRagRetrieval.hasReadyDocuments.mockResolvedValue(true);
      mockRagRetrieval.retrieve.mockRejectedValue(new Error('pgvector down'));
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          { type: 'text-delta', content: 'Answer without sources.' },
          {
            type: 'finish',
            model: 'gpt-4o-mini',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            cost: null,
            finishReason: 'stop',
            ttftMs: 100,
            totalMs: 300,
          },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hello',
      })) {
        chunks.push(chunk);
      }

      const steps = chunks.filter(
        (c) => (c as { type: string }).type === 'step',
      ) as Array<{ step: { status: string } }>;
      expect(steps[1]!.step.status).toBe('error');
      // The turn still completes.
      expect(
        (chunks[chunks.length - 1] as { type: string }).type,
      ).toBe('finish');
      const llmReq = mockLlm.streamCompletion.mock.calls[0][0] as {
        systemPrompt: string;
      };
      expect(llmReq.systemPrompt).not.toContain('[RETRIEVED KNOWLEDGE]');
    });

    it('surfaces integration tool activity as step chunks', async () => {
      mockAgentTools.buildToolsForAgent.mockResolvedValue({
        tools: { hubspot_find_contact: { execute: jest.fn() } },
        stepMeta: {
          hubspot_find_contact: {
            activeLabel: 'Looking up customer data…',
            doneLabel: 'Fetched customer data',
            errorLabel: 'Customer lookup failed',
          },
        },
      });
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'hubspot_find_contact',
            input: { email: 'a@b.com' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'hubspot_find_contact',
          },
          { type: 'text-delta', content: 'Found you!' },
          {
            type: 'finish',
            model: 'gpt-4o-mini',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            cost: null,
            finishReason: 'stop',
            ttftMs: 100,
            totalMs: 300,
          },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Do you have my details? a@b.com',
      })) {
        chunks.push(chunk);
      }

      const steps = chunks.filter(
        (c) => (c as { type: string }).type === 'step',
      ) as Array<{ step: { id: string; label: string; status: string } }>;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.step).toMatchObject({
        id: 'tool-call-1',
        label: 'Looking up customer data…',
        status: 'active',
      });
      expect(steps[1]!.step).toMatchObject({
        id: 'tool-call-1',
        label: 'Fetched customer data',
        status: 'done',
      });

      // The tools were forwarded to the LLM call.
      const llmReq = mockLlm.streamCompletion.mock.calls[0][0] as {
        tools?: Record<string, unknown>;
        maxSteps?: number;
      };
      expect(llmReq.tools).toHaveProperty('hubspot_find_contact');
      expect(llmReq.maxSteps).toBe(5);
    });

    it('yields an error chunk when the LLM stream errors mid-flight', async () => {
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          { type: 'text-delta', content: 'partial' },
          { type: 'error', error: 'upstream 500' },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      })) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find(
        (c) => (c as { type: string }).type === 'error',
      ) as { type: 'error'; error: string; code?: string };
      expect(errorChunk).toBeDefined();
      expect(errorChunk.error).toBe('upstream 500');
    });

    it('marks abort signal as ABORTED code', async () => {
      mockLlm.streamCompletion.mockImplementation(() => {
        const err = new Error('Request aborted');
        err.name = 'AbortError';
        throw err;
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      })) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find(
        (c) => (c as { type: string }).type === 'error',
      ) as { type: 'error'; error: string; code?: string };
      expect(errorChunk).toBeDefined();
      expect(errorChunk.code).toBe('ABORTED');
    });

    it('throws when LLM stream ends without a finish event', async () => {
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([{ type: 'text-delta', content: 'no finish' }]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      })) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find(
        (c) => (c as { type: string }).type === 'error',
      ) as { type: 'error'; error: string };
      expect(errorChunk).toBeDefined();
      expect(errorChunk.error).toMatch(/without a finish event/);
    });

    it('emits a knowledge.load trace event reflecting absence', async () => {
      mockLlm.streamCompletion.mockResolvedValue({
        stream: tokenStream([
          { type: 'text-delta', content: 'ok' },
          {
            type: 'finish',
            model: 'gpt-4o',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              cachedInputTokens: 0,
              reasoningTokens: undefined,
            },
            cost: 0,
            finishReason: 'stop',
            ttftMs: 100,
            totalMs: 200,
          },
        ]),
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.stream({
        agent: mockAgent,
        chatSessionId: 'sess-1',
        newUserMessage: 'Hi',
      })) {
        chunks.push(chunk);
      }

      const knowledgeChunk = chunks.find(
        (c) =>
          (c as { type: string; step?: string }).type === 'trace' &&
          (c as { step?: string }).step === 'knowledge.load',
      ) as { data?: { hasKnowledge: boolean } } | undefined;
      expect(knowledgeChunk?.data?.hasKnowledge).toBe(false);
    });
  });

  describe('config fallback on invalid aiConfig', () => {
    it('does not throw — falls back to schema defaults', async () => {
      const brokenAgent = {
        ...mockAgent,
        aiConfig: { temperature: 9999 }, // out-of-bounds
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      mockLlm.generateCompletion.mockResolvedValue({
        text: 'ok',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cachedInputTokens: 0,
          reasoningTokens: undefined,
        },
        cost: 0,
        model: 'x',
        finishReason: 'stop',
        latencyMs: 100,
        retryCount: 0,
      });
      await expect(
        service.send({
          agent: brokenAgent,
          chatSessionId: 'sess-1',
          newUserMessage: 'Hi',
        }),
      ).resolves.toBeDefined();
    });
  });
});
