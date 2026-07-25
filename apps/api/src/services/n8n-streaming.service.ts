import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { N8nStreamChunk, VALID_CHUNK_TYPES } from './n8n-stream.interface';

const DEFAULT_STREAM_TIMEOUT_MS = 30_000;
const MAX_BUFFER_SIZE = 1_048_576; // 1 MB

/**
 * True if an IP literal falls in a range we must never let the server dial:
 * loopback, RFC1918 private, link-local, CGNAT, ULA, multicast/reserved. Used
 * to block SSRF where a tenant points their agent webhook at an internal host.
 */
function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const octets = ip.split('.').map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 — embeds an IPv4 target

    // IPv4-mapped IPv6 embeds an IPv4 address that must be range-checked, in ALL
    // its textual forms: dotted (::ffff:127.0.0.1), hex (::ffff:7f00:1), and the
    // fully-expanded 0:0:0:0:0:ffff:7f00:1. Extract the embedded IPv4 and recurse.
    const mappedTail = lower.match(/(?:^::ffff:|^(?:0+:){5}ffff:)(.+)$/);
    if (mappedTail) {
      const tail = mappedTail[1]!;
      const dotted = tail.match(/^\d+\.\d+\.\d+\.\d+$/);
      if (dotted) return isBlockedAddress(tail);
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1]!, 16);
        const lo = parseInt(hex[2]!, 16);
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isBlockedAddress(ipv4);
      }
      return true; // unrecognized mapped form → block to be safe
    }
    return false;
  }
  return true; // not a valid IP literal → block
}

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

    await this.assertPublicWebhookHost(webhookUrl);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatInput: message, sessionId }),
        signal: combinedSignal,
        // Never auto-follow redirects: a 30x to an internal address would bypass
        // the pre-flight host check below (SSRF via redirect).
        redirect: 'error',
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
   * Reject a webhook URL that would make the server dial an internal address.
   * Requires http(s), and resolves the host, blocking if the literal — or ANY
   * resolved A/AAAA record — falls in a private/loopback/link-local range.
   * Throws before any request is issued. (DNS can still rebind between this
   * check and connect; an egress allowlist/proxy is the defense-in-depth layer.)
   */
  private async assertPublicWebhookHost(webhookUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(webhookUrl);
    } catch {
      throw new Error('Invalid webhook URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Webhook URL must use http or https');
    }

    // Enforce SSRF host-blocking in PRODUCTION only. Local dev/test rigs
    // legitimately point the webhook at localhost / 127.0.0.1 / ::1 (a dev n8n
    // instance), so blocking is skipped outside production — no env setup needed
    // to develop locally. `N8N_ALLOW_PRIVATE_WEBHOOK_HOSTS=true` is an escape
    // hatch to disable it even in production (e.g. a private-network n8n reached
    // over a VPC); it never forces blocking on elsewhere.
    const enforceBlock =
      process.env.NODE_ENV === 'production' &&
      process.env.N8N_ALLOW_PRIVATE_WEBHOOK_HOSTS !== 'true';
    if (!enforceBlock) return;

    // `URL.hostname` wraps IPv6 literals in brackets ("[::1]"); strip them so
    // isIP/range-checking sees the bare address.
    const host = url.hostname.replace(/^\[|\]$/g, '');

    if (isIP(host)) {
      if (isBlockedAddress(host)) {
        throw new Error('Webhook URL resolves to a disallowed address');
      }
      return;
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error('Webhook host could not be resolved');
    }

    for (const { address } of addresses) {
      if (isBlockedAddress(address)) {
        throw new Error('Webhook URL resolves to a disallowed address');
      }
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
