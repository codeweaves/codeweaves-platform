import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/** Hard cap on downloaded HTML — protects memory + the extraction bill. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface FetchedPage {
  /** Extracted plain text. */
  text: string;
  /** <title> content when present. */
  title: string | null;
  /** Final content type. */
  contentType: string | null;
}

/**
 * UrlFetcherService: fetches a customer-supplied URL for knowledge ingestion.
 *
 * This is user-controlled outbound HTTP from inside our network = an SSRF
 * vector by construction (see agent-data-and-integrations-plan §7.1). Guards:
 *
 *   - https/http only, default ports only (80/443)
 *   - hostname resolved via DNS BEFORE connecting; every resolved address
 *     (A + AAAA) must be public — loopback, RFC1918, link-local, CGNAT,
 *     cloud-metadata (169.254.169.254), ULA/site-local etc. are rejected
 *   - redirects are NOT followed (a redirect to an internal address is the
 *     classic bypass); we surface the redirect location as an error instead
 *   - response size + time capped
 *
 * DNS-rebinding note: we resolve once for validation and then let fetch
 * resolve again for the connection — a determined attacker with a rebinding
 * DNS server could race the two lookups. Node's global fetch (undici) exposes
 * no per-request lookup pin without swapping HTTP clients. Accepted for this
 * feature because (a) ingestion is a dashboard-authenticated, rate-limited,
 * low-frequency action, (b) the response is only ever *indexed as text*,
 * never echoed raw or used for auth, and (c) egress from the API host is the
 * same origin the widget already talks to. Revisit with a pinned-agent client
 * if we ever execute customer URLs on the chat hot path.
 */
@Injectable()
export class UrlFetcherService {
  private readonly logger = new Logger(UrlFetcherService.name);

  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    const url = this.parseAndValidateUrl(rawUrl);
    await this.assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CodeWeavesBot/1.0 (+knowledge-base-ingestion)',
          Accept: 'text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1',
        },
      });
    } catch (err) {
      throw new BadRequestException(
        `Could not fetch URL: ${err instanceof Error && err.name === 'AbortError' ? 'request timed out' : 'network error'}.`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      throw new BadRequestException(
        `URL redirects (${res.status}). Please provide the final URL directly.`,
      );
    }
    if (!res.ok) {
      throw new BadRequestException(
        `URL returned HTTP ${res.status}. The page must be publicly accessible.`,
      );
    }

    const contentType = res.headers.get('content-type');
    if (
      contentType &&
      !/text\/html|text\/plain|text\/markdown|application\/xhtml/i.test(
        contentType,
      )
    ) {
      throw new BadRequestException(
        `Unsupported content type "${contentType}". Only web pages and plain text can be ingested from URLs — upload PDFs/DOCX as files instead.`,
      );
    }

    const body = await this.readCapped(res);

    if (contentType && /text\/(plain|markdown)/i.test(contentType)) {
      return { text: body, title: null, contentType };
    }
    const { text, title } = htmlToText(body);
    return { text, title, contentType };
  }

  private parseAndValidateUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('Only http(s) URLs are supported.');
    }
    if (url.port && url.port !== '80' && url.port !== '443') {
      throw new BadRequestException('Non-standard ports are not allowed.');
    }
    if (url.username || url.password) {
      throw new BadRequestException('URLs with credentials are not allowed.');
    }
    return url;
  }

  /** Resolve the host and reject anything that lands on a private network. */
  private async assertPublicHost(hostname: string): Promise<void> {
    // IP literals skip DNS entirely.
    if (isIP(hostname)) {
      if (isPrivateAddress(hostname)) {
        throw new BadRequestException('URL resolves to a private address.');
      }
      return;
    }
    let addresses: { address: string }[];
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException(`Could not resolve host "${hostname}".`);
    }
    if (addresses.length === 0) {
      throw new BadRequestException(`Could not resolve host "${hostname}".`);
    }
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        this.logger.warn(
          `SSRF blocked: ${hostname} resolves to private address ${address}`,
        );
        throw new BadRequestException('URL resolves to a private address.');
      }
    }
  }

  /** Stream the body with a byte cap so huge pages can't exhaust memory. */
  private async readCapped(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new BadRequestException(
          `Page exceeds the ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)} MB download limit.`,
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * True for every address range that must never be reachable from a
 * customer-supplied URL: loopback, RFC1918, link-local + cloud metadata,
 * CGNAT, unspecified, multicast/broadcast, and their IPv6 equivalents
 * (including IPv4-mapped forms).
 */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return isPrivateV4(address);
  if (v === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) — check the embedded v4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateV4(mapped[1]!);
    if (lower === '::' || lower === '::1') return true; // unspecified / loopback
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
    if (lower.startsWith('ff')) return true; // multicast
    return false;
  }
  // Not an IP at all — treat as private (defensive).
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // unspecified / RFC1918 / loopback
  if (a === 100 && b! >= 64 && b! <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b! >= 16 && b! <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 special + 192.0.2.0/24 doc
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * Minimal, dependency-free HTML → text extraction. Good enough for knowledge
 * ingestion: strips script/style/nav chrome, converts block boundaries to
 * newlines, decodes common entities. NOT a sanitiser (output is only embedded
 * and shown in the dashboard as text) and NOT a full readability algorithm —
 * upgrade to a real extractor if customers ingest complex app-like pages.
 */
export function htmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.trim()).slice(0, 255) || null : null;

  let s = html
    // Drop non-content subtrees entirely.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ');

  // Preserve heading structure so the markdown chunker can use it.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, ' ').trim();
    return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
  });

  // Block-level boundaries → newlines; everything else → space.
  s = s
    .replace(/<\/(p|div|li|tr|table|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  // Collapse whitespace but keep paragraph breaks.
  const text = s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => {
      const n = Number.parseInt(code, 16);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
}
