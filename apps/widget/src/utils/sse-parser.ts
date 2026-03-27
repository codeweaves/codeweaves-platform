/**
 * SSE response parser for POST-based streaming (Story 5-15, Task 4).
 *
 * Native EventSource only supports GET — our /public/chat/stream endpoint
 * uses POST, so we manually parse the SSE text protocol from a ReadableStream.
 *
 * Yields typed SSEEvent objects as they arrive:
 *   { type: 'chunk', content }
 *   { type: 'done', sessionId, messageId, metadata }
 *   { type: 'error', message }
 */

export interface SSEChunkEvent {
  type: 'chunk';
  content: string;
}

export interface SSEDoneEvent {
  type: 'done';
  sessionId: string;
  messageId: string;
  metadata: Record<string, unknown>;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

export type SSEEvent = SSEChunkEvent | SSEDoneEvent | SSEErrorEvent;

/**
 * Async generator that reads from a ReadableStream, buffers partial lines,
 * splits on `\n\n` SSE boundaries, and yields parsed SSEEvent objects.
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        // Normalize \r\n and \r to \n (SSE spec allows all three line endings)
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      }

      // Process complete SSE messages (delimited by double newline)
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const event = parseSSEMessage(message);
        if (event) yield event;

        boundary = buffer.indexOf('\n\n');
      }

      if (done) {
        // Process any remaining buffered data
        if (buffer.trim()) {
          const event = parseSSEMessage(buffer);
          if (event) yield event;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE message block into a typed event.
 * SSE format: `data: {json}\n` (one or more data lines per message).
 */
function parseSSEMessage(message: string): SSEEvent | null {
  const lines = message.split('\n');
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataStr += line.slice(6);
    } else if (line.startsWith('data:')) {
      dataStr += line.slice(5);
    }
    // Ignore comment lines (starting with :) and other fields (event:, id:, retry:)
  }

  if (!dataStr) return null;

  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>;
    const type = data.type as string;

    if (type === 'chunk') {
      return { type: 'chunk', content: data.content as string };
    }

    if (type === 'done') {
      return {
        type: 'done',
        sessionId: data.sessionId as string,
        messageId: data.messageId as string,
        metadata: (data.metadata as Record<string, unknown>) ?? {},
      };
    }

    if (type === 'error') {
      return { type: 'error', message: data.message as string };
    }

    return null;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[cw-widget] Failed to parse SSE data:', dataStr, e);
    }
    return null;
  }
}
