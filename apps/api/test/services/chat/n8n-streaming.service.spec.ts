import { lookup } from 'node:dns/promises';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { N8nStreamingService } from '../../../src/services/n8n-streaming.service';
import { N8nStreamChunk } from '../../../src/services/n8n-stream.interface';

// The service now resolves the webhook host and blocks private/loopback ranges
// (SSRF guard). In tests the fixture host has no real DNS record, so mock the
// resolver to a public address — the guard passes and fetch (mocked) drives the
// actual test behavior. SSRF-blocking behavior is covered by dedicated cases.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));
const mockLookup = lookup as jest.Mock;
const PUBLIC_DNS_RESULT = [{ address: '93.184.216.34', family: 4 }];

describe('N8nStreamingService', () => {
  let service: N8nStreamingService;
  const originalFetch = global.fetch;

  const WEBHOOK_URL = 'https://n8n.example.com/webhook/chat-trigger';
  const MESSAGE = 'Hello AI';
  const SESSION_ID = 'session-abc-123';

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined),
  };

  /**
   * Helper: creates a Response with a ReadableStream body from string chunks.
   */
  function createChunkedResponse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  /**
   * Helper: creates a Response with a ReadableStream that delivers chunks with delays,
   * allowing mid-stream abort testing.
   */
  function createDelayedChunkedResponse(chunks: string[], delayMs: number): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Stream may have been cancelled
            return;
          }
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  /**
   * Helper: collect all chunks from the async generator.
   */
  async function collectChunks(
    gen: AsyncGenerator<N8nStreamChunk>,
  ): Promise<N8nStreamChunk[]> {
    const result: N8nStreamChunk[] = [];
    for await (const chunk of gen) {
      result.push(chunk);
    }
    return result;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        N8nStreamingService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<N8nStreamingService>(N8nStreamingService);
    jest.clearAllMocks();
    // Re-establish after clearAllMocks so the SSRF host check resolves to a
    // public address for the normal streaming cases.
    mockLookup.mockResolvedValue(PUBLIC_DNS_RESULT);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('streamFromWebhookUrl', () => {
    describe('SSRF guard', () => {
      // Host-blocking is production-only (local dev points at localhost), so
      // force production mode to exercise it.
      const prevNodeEnv = process.env.NODE_ENV;
      beforeAll(() => {
        process.env.NODE_ENV = 'production';
      });
      afterAll(() => {
        process.env.NODE_ENV = prevNodeEnv;
      });

      it('rejects a loopback IP literal without issuing a request', async () => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(
            service.streamFromWebhookUrl(
              'http://127.0.0.1/webhook',
              MESSAGE,
              SESSION_ID,
            ),
          ),
        ).rejects.toThrow('disallowed address');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('rejects a private RFC1918 IP literal', async () => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(
            service.streamFromWebhookUrl(
              'http://10.0.0.5/webhook',
              MESSAGE,
              SESSION_ID,
            ),
          ),
        ).rejects.toThrow('disallowed address');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('rejects a loopback IPv4-mapped IPv6 literal (hex form)', async () => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(
            service.streamFromWebhookUrl(
              'http://[::ffff:7f00:1]/webhook', // ::ffff:127.0.0.1 in hex
              MESSAGE,
              SESSION_ID,
            ),
          ),
        ).rejects.toThrow('disallowed address');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('rejects a loopback IPv4-mapped IPv6 literal (dotted form)', async () => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(
            service.streamFromWebhookUrl(
              'http://[::ffff:127.0.0.1]/webhook',
              MESSAGE,
              SESSION_ID,
            ),
          ),
        ).rejects.toThrow('disallowed address');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it.each([
        ['fully-expanded loopback', 'http://[0:0:0:0:0:0:0:1]/webhook'],
        ['zero-compressed loopback', 'http://[0::1]/webhook'],
        ['zero-padded loopback', 'http://[::0001]/webhook'],
        ['link-local outside fe80 prefix', 'http://[fe90::1]/webhook'],
        ['link-local upper bound', 'http://[febf::1]/webhook'],
        ['unique-local', 'http://[fd12:3456::1]/webhook'],
        ['IPv4-compatible private', 'http://[::10.0.0.1]/webhook'],
        ['NAT64-embedded loopback', 'http://[64:ff9b::7f00:1]/webhook'],
        ['6to4-embedded loopback', 'http://[2002:7f00:1::1]/webhook'],
        ['Teredo', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/webhook'],
      ])('blocks canonical-equivalent IPv6 form: %s', async (_label, url) => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(service.streamFromWebhookUrl(url, MESSAGE, SESSION_ID)),
        ).rejects.toThrow('disallowed address');
        expect(global.fetch).not.toHaveBeenCalled();
      });

      it('rejects a non-http(s) scheme', async () => {
        global.fetch = jest.fn();
        await expect(
          collectChunks(
            service.streamFromWebhookUrl(
              'file:///etc/passwd',
              MESSAGE,
              SESSION_ID,
            ),
          ),
        ).rejects.toThrow('http or https');
        expect(global.fetch).not.toHaveBeenCalled();
      });
    });

    it('should stream a normal multi-chunk response', async () => {
      const lines = [
        '{"type":"begin","metadata":{"nodeId":"n1","timestamp":1000}}\n',
        '{"type":"item","content":"Hello","metadata":{"nodeId":"n1","timestamp":1001}}\n',
        '{"type":"item","content":" world","metadata":{"nodeId":"n1","timestamp":1002}}\n',
        '{"type":"end","metadata":{"nodeId":"n1","timestamp":1003}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual({ type: 'begin', metadata: { nodeId: 'n1', timestamp: 1000 } });
      expect(chunks[1]).toEqual({ type: 'item', content: 'Hello', metadata: { nodeId: 'n1', timestamp: 1001 } });
      expect(chunks[2]).toEqual({ type: 'item', content: ' world', metadata: { nodeId: 'n1', timestamp: 1002 } });
      expect(chunks[3]).toEqual({ type: 'end', metadata: { nodeId: 'n1', timestamp: 1003 } });

      expect(global.fetch).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatInput: MESSAGE, sessionId: SESSION_ID }),
        }),
      );
    });

    it('should handle a single chunk response', async () => {
      const lines = [
        '{"type":"item","content":"Single","metadata":{"timestamp":1000}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'item', content: 'Single', metadata: { timestamp: 1000 } });
    });

    it('should handle an empty response body', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse([]),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(0);
    });

    it('should skip malformed JSON chunks without breaking the stream', async () => {
      const lines = [
        '{"type":"begin","metadata":{"timestamp":1000}}\n',
        'THIS IS NOT JSON\n',
        '{"type":"item","content":"valid","metadata":{"timestamp":1001}}\n',
        '{broken json\n',
        '{"type":"end","metadata":{"timestamp":1002}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]!.type).toBe('begin');
      expect(chunks[1]).toEqual({ type: 'item', content: 'valid', metadata: { timestamp: 1001 } });
      expect(chunks[2]!.type).toBe('end');
    });

    it('should handle partial chunks split across TCP read boundaries', async () => {
      const chunk1 = '{"type":"begin","metadata":{"timestamp":1000}}\n{"type":"it';
      const chunk2 = 'em","content":"split","metadata":{"timestamp":1001}}\n';
      const chunk3 = '{"type":"end","metadata":{"timestamp":1002}}\n';

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse([chunk1, chunk2, chunk3]),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'begin', metadata: { timestamp: 1000 } });
      expect(chunks[1]).toEqual({ type: 'item', content: 'split', metadata: { timestamp: 1001 } });
      expect(chunks[2]).toEqual({ type: 'end', metadata: { timestamp: 1002 } });
    });

    it('should handle final chunk without trailing newline', async () => {
      const chunk = '{"type":"begin","metadata":{"timestamp":1000}}\n{"type":"end","metadata":{"timestamp":1001}}';

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse([chunk]),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.type).toBe('begin');
      expect(chunks[1]!.type).toBe('end');
    });

    it('should throw on timeout during fetch', async () => {
      const error = new DOMException('The operation was aborted.', 'TimeoutError');
      global.fetch = jest.fn().mockRejectedValue(error);

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Streaming request timed out');
    });

    it('should handle abort signal cancellation during fetch', async () => {
      const error = new DOMException('The operation was aborted.', 'AbortError');
      global.fetch = jest.fn().mockRejectedValue(error);

      const abortController = new AbortController();
      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID, abortController.signal),
      );

      expect(chunks).toHaveLength(0);
    });

    it('should handle abort during active stream reading', async () => {
      const abortController = new AbortController();

      global.fetch = jest.fn().mockResolvedValue(
        createDelayedChunkedResponse(
          [
            '{"type":"begin","metadata":{"timestamp":1000}}\n',
            '{"type":"item","content":"A","metadata":{"timestamp":1001}}\n',
            '{"type":"item","content":"B","metadata":{"timestamp":1002}}\n',
            '{"type":"end","metadata":{"timestamp":1003}}\n',
          ],
          50,
        ),
      );

      const chunks: N8nStreamChunk[] = [];
      const gen = service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID, abortController.signal);

      // Read first chunk, then abort
      const first = await gen.next();
      if (!first.done) chunks.push(first.value);
      abortController.abort();

      // Collect remaining — should terminate gracefully
      try {
        for await (const chunk of gen) {
          chunks.push(chunk);
        }
      } catch {
        // AbortError may propagate — that's acceptable
      }

      // Should have at least the first chunk but NOT all 4
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.length).toBeLessThan(4);
    });

    it('should handle timeout during active stream reading', async () => {
      // Simulate a stream that stalls after first chunk — never closes
      const encoder = new TextEncoder();
      let readerCancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"begin","metadata":{"timestamp":1000}}\n'));
          // Never close or enqueue more — simulates n8n hanging mid-stream
        },
        cancel() {
          readerCancelled = true;
        },
      });
      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

      global.fetch = jest.fn().mockResolvedValue(response);

      // Use a very short timeout to test mid-stream timeout
      mockConfigService.get.mockReturnValue(100); // 100ms timeout
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          N8nStreamingService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const shortTimeoutService = module.get<N8nStreamingService>(N8nStreamingService);

      // The abort signal fires, reader.cancel() is called, and the stream terminates.
      // Depending on timing, it may throw timeout or resolve with partial chunks.
      const chunks = await collectChunks(
        shortTimeoutService.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      ).catch((err: Error) => {
        expect(err.message).toBe('Streaming request timed out');
        return [] as N8nStreamChunk[];
      });

      // Either way, stream didn't hang forever and reader was cancelled
      expect(chunks.length).toBeLessThanOrEqual(1);
      // Give the cancel a tick to propagate
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(readerCancelled).toBe(true);
    });

    it('should throw on non-ok HTTP response and read error body', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('{"error":"Workflow not found"}', { status: 404 }),
      );

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Streaming endpoint returned HTTP 404');
    });

    it('should throw on non-ok response with HTML error body', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }),
      );

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Streaming endpoint returned HTTP 502');
    });

    it('should throw on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Failed to connect to streaming endpoint');
    });

    it('should throw when response has no body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response;

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Streaming response has no body');
    });

    it('should handle multiple JSON lines in a single TCP chunk', async () => {
      const singleChunk =
        '{"type":"begin","metadata":{"timestamp":1000}}\n' +
        '{"type":"item","content":"A","metadata":{"timestamp":1001}}\n' +
        '{"type":"item","content":"B","metadata":{"timestamp":1002}}\n' +
        '{"type":"end","metadata":{"timestamp":1003}}\n';

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse([singleChunk]),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(4);
      expect(chunks[1]!.content).toBe('A');
      expect(chunks[2]!.content).toBe('B');
    });

    it('should skip empty lines between chunks', async () => {
      const lines = [
        '{"type":"begin","metadata":{"timestamp":1000}}\n\n\n',
        '{"type":"end","metadata":{"timestamp":1001}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(2);
    });

    it('should skip chunks with unknown type field', async () => {
      const lines = [
        '{"type":"begin","metadata":{"timestamp":1000}}\n',
        '{"type":"error","message":"quota exceeded"}\n',
        '{"type":"unknown","data":"something"}\n',
        '{"type":"item","content":"valid","metadata":{"timestamp":1001}}\n',
        '{"type":"end","metadata":{"timestamp":1002}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]!.type).toBe('begin');
      expect(chunks[1]!.type).toBe('item');
      expect(chunks[2]!.type).toBe('end');
    });

    it('should skip chunks with no type field', async () => {
      const lines = [
        '{"type":"begin","metadata":{"timestamp":1000}}\n',
        '{"foo":"bar"}\n',
        '{"content":"orphaned"}\n',
        '{"type":"end","metadata":{"timestamp":1001}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(chunks).toHaveLength(2);
      expect(chunks[0]!.type).toBe('begin');
      expect(chunks[1]!.type).toBe('end');
    });

    it('should warn but still yield begin/end chunks missing metadata.timestamp', async () => {
      const lines = [
        '{"type":"begin"}\n',
        '{"type":"item","content":"Hi"}\n',
        '{"type":"end","metadata":{}}\n',
      ];

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse(lines),
      );

      const chunks = await collectChunks(
        service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      // Chunks are still yielded (with warning logged), not dropped
      expect(chunks).toHaveLength(3);
      expect(chunks[0]!.type).toBe('begin');
      expect(chunks[0]!.metadata).toBeUndefined();
      expect(chunks[2]!.type).toBe('end');
    });

    it('should throw when buffer exceeds max size', async () => {
      // Create a chunk larger than 1MB with no newlines
      const hugeChunk = 'x'.repeat(1_048_577);

      global.fetch = jest.fn().mockResolvedValue(
        createChunkedResponse([hugeChunk]),
      );

      await expect(
        collectChunks(service.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID)),
      ).rejects.toThrow('Streaming response exceeded maximum buffer size');
    });

    it('should use configurable timeout from ConfigService', async () => {
      mockConfigService.get.mockReturnValue(5000);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          N8nStreamingService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const customService = module.get<N8nStreamingService>(N8nStreamingService);

      global.fetch = jest.fn().mockResolvedValue(createChunkedResponse([]));

      await collectChunks(
        customService.streamFromWebhookUrl(WEBHOOK_URL, MESSAGE, SESSION_ID),
      );

      expect(mockConfigService.get).toHaveBeenCalledWith('N8N_STREAM_TIMEOUT_MS');
      // Verify fetch was called (with signal containing the custom timeout)
      expect(global.fetch).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});
