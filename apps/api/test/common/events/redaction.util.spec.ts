import {
  sanitizeHeaders,
  redact,
  capJson,
  safeMeta,
} from '../../../src/common/events/redaction.util';

describe('redaction.util', () => {
  describe('sanitizeHeaders', () => {
    it('drops auth / cookie / api-key / signature headers', () => {
      const out = sanitizeHeaders({
        authorization: 'Bearer secret',
        cookie: 'session=abc',
        'x-api-key': 'k',
        'xi-api-key': 'k',
        'x-hub-signature-256': 'sig',
        'x-internal-secret': 's',
        'x-correlation-id': 'keep-me',
      });
      expect(out).toEqual({ 'x-correlation-id': 'keep-me' });
      expect(out).not.toHaveProperty('authorization');
    });

    it('drops noisy transport headers but keeps useful custom ones', () => {
      const out = sanitizeHeaders({
        host: 'example.com',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'user-agent': 'jest',
        'x-forwarded-for': '1.2.3.4',
      });
      expect(out).toEqual({
        'content-type': 'application/json',
        'user-agent': 'jest',
        'x-forwarded-for': '1.2.3.4',
      });
    });

    it('returns undefined when nothing survives (so the column can be omitted)', () => {
      expect(sanitizeHeaders({ authorization: 'x', host: 'y' })).toBeUndefined();
      expect(sanitizeHeaders(undefined)).toBeUndefined();
      expect(sanitizeHeaders(null)).toBeUndefined();
    });

    it('reads a fetch Headers instance', () => {
      const h = new Headers();
      h.set('authorization', 'Bearer x');
      h.set('content-type', 'application/json');
      expect(sanitizeHeaders(h)).toEqual({ 'content-type': 'application/json' });
    });
  });

  describe('redact', () => {
    it('replaces sensitive keys with [REDACTED] at any depth', () => {
      const out = redact({
        email: 'a@b.com',
        password: 'hunter2',
        nested: { apiKey: 'k', accessToken: 't', ok: 1 },
      }) as {
        email: string;
        password: string;
        nested: { apiKey: string; accessToken: string; ok: number };
      };
      expect(out.email).toBe('a@b.com');
      expect(out.password).toBe('[REDACTED]');
      expect(out.nested.apiKey).toBe('[REDACTED]');
      expect(out.nested.accessToken).toBe('[REDACTED]');
      expect(out.nested.ok).toBe(1);
    });

    it('preserves token-count / timing metrics (the telemetry we exist to capture)', () => {
      const out = redact({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 10,
        maxTokens: 4096,
        timeToFirstToken: 320,
        timeToLastToken: 900,
      }) as Record<string, number>;
      expect(out.inputTokens).toBe(100);
      expect(out.totalTokens).toBe(150);
      expect(out.maxTokens).toBe(4096);
      expect(out.timeToFirstToken).toBe(320);
      expect(out.cachedInputTokens).toBe(10);
    });

    it('still redacts real token secrets (access/refresh/api/bare token)', () => {
      const out = redact({
        accessToken: 'a',
        refreshToken: 'b',
        apiToken: 'c',
        token: 'd',
      }) as Record<string, string>;
      expect(out.accessToken).toBe('[REDACTED]');
      expect(out.refreshToken).toBe('[REDACTED]');
      expect(out.apiToken).toBe('[REDACTED]');
      expect(out.token).toBe('[REDACTED]');
    });

    it('reduces Buffers/Uint8Array to byte metadata, never raw bytes', () => {
      expect(redact(Buffer.from('hello'))).toEqual({ _binary: true, bytes: 5 });
      expect(redact(new Uint8Array([1, 2, 3]))).toEqual({ _binary: true, bytes: 3 });
    });

    it('caps very long strings', () => {
      const out = redact('x'.repeat(5000)) as string;
      expect(out.length).toBeLessThanOrEqual(2001);
      expect(out.endsWith('…')).toBe(true);
    });

    it('caps recursion depth', () => {
      let deep: unknown = 'leaf';
      for (let i = 0; i < 10; i++) deep = { next: deep };
      expect(JSON.stringify(redact(deep))).toContain('[depth-capped]');
    });
  });

  describe('capJson', () => {
    it('returns undefined for null/undefined (so Prisma column is omitted, not null)', () => {
      expect(capJson(undefined)).toBeUndefined();
      expect(capJson(null)).toBeUndefined();
    });

    it('passes small payloads through (redacted)', () => {
      expect(capJson({ a: 1, token: 'x' })).toEqual({ a: 1, token: '[REDACTED]' });
    });

    it('caps a single huge string via redact (below the byte cap)', () => {
      const out = capJson({ blob: 'y'.repeat(50_000) }) as {
        _truncated?: boolean;
        blob: string;
      };
      // redact caps the string at 2000 chars, so it never trips the byte cap.
      expect(out._truncated).toBeUndefined();
      expect(out.blob.length).toBeLessThanOrEqual(2001);
    });

    it('truncates payloads whose total size exceeds the byte cap', () => {
      // 50 items × ~2000 chars each ≈ 100 KB > 32 KB cap.
      const big = {
        items: Array.from({ length: 50 }, (_, i) => ({ text: 'y'.repeat(2000), i })),
      };
      const out = capJson(big) as {
        _truncated?: boolean;
        _bytes?: number;
        preview?: string;
      };
      expect(out._truncated).toBe(true);
      expect(typeof out._bytes).toBe('number');
      expect(typeof out.preview).toBe('string');
    });
  });

  describe('safeMeta', () => {
    it('survives cycles (depth-cap breaks them) and redacts sensitive keys', () => {
      const cyclic: Record<string, unknown> = { a: 1 };
      cyclic.self = cyclic;
      // The depth cap severs the cycle, so it serialises rather than throwing.
      expect(safeMeta(cyclic)).toContain('[depth-capped]');
      expect(safeMeta({ password: 'x', ok: 1 })).toContain('[REDACTED]');
    });

    it('falls back to a marker when a value is genuinely unserialisable', () => {
      expect(safeMeta({ n: 10n as unknown as number })).toBe('[meta-unserializable]');
    });
  });
});
