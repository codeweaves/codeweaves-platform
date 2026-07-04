import { directChatToN8nStream } from '../../../src/modules/ai/adapters/voice-token-stream.adapter';
import type {
  DirectChatResult,
  DirectChatStreamChunk,
} from '../../../src/modules/ai/interfaces/direct-chat.interfaces';
import type { N8nStreamChunk } from '../../../src/services/n8n-stream.interface';

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(
  source: AsyncIterable<DirectChatStreamChunk>,
  onFinish?: (r: DirectChatResult) => void,
): Promise<N8nStreamChunk[]> {
  const out: N8nStreamChunk[] = [];
  for await (const c of directChatToN8nStream(source, onFinish)) {
    out.push(c);
  }
  return out;
}

describe('directChatToN8nStream', () => {
  const mockResult: DirectChatResult = {
    text: 'Hello there.',
    finishReason: 'stop',
    ttftMs: 230,
    latencyMs: 510,
    model: 'gpt-4o-mini',
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    cost: 0.0001,
    traceId: 'trace-1',
    historyCount: 0,
    estimatedInputTokens: 50,
    historyTruncated: false,
    citations: [],
    ragLatencyMs: null,
  };

  it('emits a synthetic begin chunk on the first text-delta', async () => {
    const chunks = await collect(
      fromArray<DirectChatStreamChunk>([
        { type: 'text-delta', content: 'Hi' },
        { type: 'text-delta', content: ' there' },
      ]),
    );

    expect(chunks[0]).toMatchObject({ type: 'begin' });
    // Only ONE begin chunk despite multiple deltas.
    expect(chunks.filter((c) => c.type === 'begin')).toHaveLength(1);
  });

  it('maps text-delta chunks to item chunks with timestamps', async () => {
    const chunks = await collect(
      fromArray<DirectChatStreamChunk>([
        { type: 'text-delta', content: 'Hi' },
        { type: 'text-delta', content: ' there' },
      ]),
    );
    const items = chunks.filter((c) => c.type === 'item');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'item', content: 'Hi' });
    expect(items[1]).toMatchObject({ type: 'item', content: ' there' });
    expect(items[0]?.metadata?.timestamp).toEqual(expect.any(Number));
  });

  it('drops empty text-delta content (no item emitted)', async () => {
    const chunks = await collect(
      fromArray<DirectChatStreamChunk>([
        { type: 'text-delta', content: '' },
        { type: 'text-delta', content: 'real' },
      ]),
    );
    // The begin chunk fires on the FIRST delta regardless of content; then
    // we get one item for "real" only.
    const items = chunks.filter((c) => c.type === 'item');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ content: 'real' });
  });

  it('emits end chunk on finish and invokes onFinish callback with result', async () => {
    const onFinish = jest.fn();
    const chunks = await collect(
      fromArray<DirectChatStreamChunk>([
        { type: 'text-delta', content: 'Hi' },
        { type: 'finish', result: mockResult },
      ]),
      onFinish,
    );

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(mockResult);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'end' });
  });

  it('works without onFinish callback', async () => {
    await expect(
      collect(
        fromArray<DirectChatStreamChunk>([
          { type: 'text-delta', content: 'Hi' },
          { type: 'finish', result: mockResult },
        ]),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'begin' }),
        expect.objectContaining({ type: 'item', content: 'Hi' }),
        expect.objectContaining({ type: 'end' }),
      ]),
    );
  });

  it('throws on error chunk so the voice pipeline can surface NDJSON error', async () => {
    await expect(
      collect(
        fromArray<DirectChatStreamChunk>([
          { type: 'text-delta', content: 'partial' },
          { type: 'error', error: 'Provider exploded' },
        ]),
      ),
    ).rejects.toThrow('Provider exploded');
  });

  it('silently drops trace chunks (no yield, no callback)', async () => {
    const onFinish = jest.fn();
    const chunks = await collect(
      fromArray<DirectChatStreamChunk>([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'trace', event: 'llm.start' } as any,
        { type: 'text-delta', content: 'Hi' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'trace', event: 'llm.end' } as any,
        { type: 'finish', result: mockResult },
      ]),
      onFinish,
    );
    const types = chunks.map((c) => c.type);
    expect(types).not.toContain('trace');
    expect(types).toEqual(['begin', 'item', 'end']);
  });

  it('emits no chunks for an empty source', async () => {
    const chunks = await collect(fromArray<DirectChatStreamChunk>([]));
    expect(chunks).toEqual([]);
  });
});
