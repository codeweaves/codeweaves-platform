import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { N8nStreamChunk, VALID_CHUNK_TYPES } from './n8n-stream.interface';

const DEFAULT_STREAM_TIMEOUT_MS = 30_000;
const MAX_BUFFER_SIZE = 1_048_576; // 1 MB

@Injectable()
export class N8nStreamingService {
  private readonly logger = new Logger(N8nStreamingService.name);
  private readonly streamTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.streamTimeoutMs =
      this.configService.get<number>('N8N_STREAM_TIMEOUT_MS') ?? DEFAULT_STREAM_TIMEOUT_MS;
  }

  /**
   * POSTs to the agent's webhookUrl and yields token-by-token chunks
   * from the n8n Chat Trigger's chunked HTTP response.
   *
   * The response is newline-delimited JSON (NOT SSE).
   * Each line is parsed and validated as an N8nStreamChunk.
   *
   * @param webhookUrl - The agent's webhookUrl (n8n Chat Trigger endpoint)
   * @param message - User's chat message
   * @param sessionId - Session ID for conversation continuity
   * @param abortSignal - Optional signal to abort on client disconnect
   */
  async *streamFromWebhookUrl(
    webhookUrl: string,
    message: string,
    sessionId: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<N8nStreamChunk> {
    const timeoutSignal = AbortSignal.timeout(this.streamTimeoutMs);
    const combinedSignal = abortSignal
      ? AbortSignal.any([timeoutSignal, abortSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatInput: message, sessionId }),
        signal: combinedSignal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        this.logger.warn(`Streaming timeout for session ${sessionId}`);
        throw new Error('Streaming request timed out');
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.logger.debug(`Stream aborted for session ${sessionId}`);
        return;
      }
      this.logger.error(
        `Streaming fetch error for session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw new Error('Failed to connect to streaming endpoint');
    }

    if (!response.ok) {
      const errorBody = await this.safeReadErrorBody(response);
      this.logger.error(
        `Streaming endpoint returned ${response.status} for session ${sessionId}: ${errorBody}`,
      );
      throw new Error(`Streaming endpoint returned HTTP ${response.status}`);
    }

    const body = response.body;
    if (!body) {
      this.logger.error(`No response body for streaming session ${sessionId}`);
      throw new Error('Streaming response has no body');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    combinedSignal.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > MAX_BUFFER_SIZE) {
          this.logger.error(`Buffer exceeded ${MAX_BUFFER_SIZE} bytes for session ${sessionId}, aborting`);
          throw new Error('Streaming response exceeded maximum buffer size');
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = this.parseChunk(line, sessionId);
          if (chunk) yield chunk;
        }
      }

      // Process any remaining content in buffer after stream ends
      if (buffer.trim()) {
        const chunk = this.parseChunk(buffer, sessionId);
        if (chunk) yield chunk;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.logger.debug(`Stream reading aborted for session ${sessionId}`);
        return;
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        this.logger.warn(`Stream reading timed out for session ${sessionId}`);
        throw new Error('Streaming request timed out');
      }
      throw error;
    } finally {
      combinedSignal.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
  }

  /**
   * Parses and validates a single line as an N8nStreamChunk.
   * Returns null if the line is empty, malformed, or has an invalid type.
   */
  private parseChunk(line: string, sessionId: string): N8nStreamChunk | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      this.logger.warn(`Malformed chunk skipped for session ${sessionId}: ${trimmed.slice(0, 100)}`);
      return null;
    }

    const type = parsed.type;
    if (typeof type !== 'string' || !VALID_CHUNK_TYPES.has(type)) {
      this.logger.warn(`Unknown chunk type skipped for session ${sessionId}: ${String(type)}`);
      return null;
    }

    const chunk = parsed as unknown as N8nStreamChunk;

    // Validate begin/end chunks have metadata with timestamp
    if ((type === 'begin' || type === 'end') && !chunk.metadata?.timestamp) {
      this.logger.warn(
        `${type} chunk missing metadata.timestamp for session ${sessionId}, yielding anyway`,
      );
    }

    return chunk;
  }

  /**
   * Safely reads the error body from a non-OK response for logging.
   */
  private async safeReadErrorBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, 200);
    } catch {
      return '(unable to read error body)';
    }
  }
}
