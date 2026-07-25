import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { N8nStreamChunk, VALID_CHUNK_TYPES } from './n8n-stream.interface';

const DEFAULT_STREAM_TIMEOUT_MS = 30_000;
const MAX_BUFFER_SIZE = 1_048_576; // 1 MB

/** True if an IPv4 literal is in a range the server must never dial. */
function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true; // unparseable → block
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments / 192.0.0.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Expand an IPv6 literal to exactly 8 numeric 16-bit groups, or null if it
 * can't be parsed. Handles `::` compression, a trailing embedded IPv4
 * (`::ffff:1.2.3.4`), and any equivalent spelling (`0::1`, `::0001`,
 * `0:0:0:0:0:0:0:1`) — textual prefix matching cannot do this safely.
 */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!; // drop any zone index

  // A trailing dotted-quad occupies the last two groups.
  let tailGroups: number[] = [];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1]!.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tailGroups = [(o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!];
    s = s.slice(0, dotted.index!).replace(/:$/, '');
    if (s === '') s = '::';
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(':');
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };

  const head = parseSide(halves[0] ?? '');
  const tail = halves.length === 2 ? parseSide(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;

  const explicit = [...head, ...tail, ...tailGroups];
  if (halves.length === 2) {
    if (explicit.length > 8) return null;
    const zeros = new Array(8 - explicit.length).fill(0) as number[];
    return [...head, ...zeros, ...tail, ...tailGroups];
  }
  return explicit.length === 8 ? explicit : null;
}

/**
 * True if an IP literal falls in a range we must never let the server dial:
 * loopback, RFC1918 private, link-local, CGNAT, ULA, multicast/reserved. Used
 * to block SSRF where a tenant points their agent webhook at an internal host.
 *
 * IPv6 is range-checked NUMERICALLY after full expansion, so canonical-equivalent
 * spellings (`0::1`, `::0001`, `0:0:0:0:0:0:0:1`) and the whole of fe80::/10 are
 * all caught — and transition ranges that embed an IPv4 target (IPv4-mapped,
 * IPv4-compatible, 6to4, Teredo, NAT64) are resolved back to that IPv4 and
 * re-checked instead of being waved through.
 */
function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family !== 6) return true; // not a valid IP literal → block

  const g = expandIpv6(ip);
  if (!g) return true; // unparseable → block

  const isZero = (upTo: number) => g.slice(0, upTo).every((x) => x === 0);
  const asIpv4 = (hi: number, lo: number) =>
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;

  // ::/128 unspecified and ::1/128 loopback
  if (isZero(7) && (g[7] === 0 || g[7] === 1)) return true;

  // ::ffff:a.b.c.d IPv4-mapped, and ::a.b.c.d IPv4-compatible (deprecated).
  if (isZero(5) && g[5] === 0xffff) return isBlockedIpv4(asIpv4(g[6]!, g[7]!));
  if (isZero(6) && g[7] !== 0) return isBlockedIpv4(asIpv4(g[6]!, g[7]!));

  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64 — embed an IPv4 destination.
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;

  // fe80::/10 link-local (fe80–febf) — prefix string matching missed fe90/fea0/feb0.
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local (fc00–fdff)
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  // ff00::/8 multicast
  if ((g[0]! & 0xff00) === 0xff00) return true;

  // 2002::/16 6to4 — groups 1-2 hold the embedded IPv4 destination.
  if (g[0] === 0x2002) return isBlockedIpv4(asIpv4(g[1]!, g[2]!));
  // 2001::/32 Teredo — blocked outright. The embedded client IPv4 is obfuscated
  // across groups 6-7 and the relay/server address in 2-3, so there is no single
  // address to range-check; no legitimate webhook host is a Teredo address.
  if (g[0] === 0x2001 && g[1] === 0x0000) return true;

  return false;
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
