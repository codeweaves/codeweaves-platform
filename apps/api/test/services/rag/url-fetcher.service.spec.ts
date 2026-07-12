import { BadRequestException } from '@nestjs/common';
import {
  UrlFetcherService,
  htmlToText,
  isPrivateAddress,
} from '../../../src/modules/rag/url-fetcher.service';

describe('isPrivateAddress (SSRF guard)', () => {
  const privateAddresses = [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1', // link-local
    'fd00::1', // ULA
    '::ffff:10.0.0.1', // IPv4-mapped private
  ];
  it.each(privateAddresses)('blocks %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  const publicAddresses = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111'];
  it.each(publicAddresses)('allows %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(false);
  });

  it('treats non-IP garbage as private (defensive)', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('htmlToText', () => {
  it('extracts title, headings and body text; strips chrome', () => {
    const html = `
      <html><head><title>Pricing — Acme</title><style>.x{color:red}</style></head>
      <body>
        <nav><a href="/">Home</a></nav>
        <h1>Pricing</h1>
        <p>Starter costs &amp; only $9/month.</p>
        <script>alert('evil')</script>
        <footer>© Acme</footer>
      </body></html>`;
    const { text, title } = htmlToText(html);
    expect(title).toBe('Pricing — Acme');
    expect(text).toContain('# Pricing'); // heading structure preserved for the markdown chunker
    expect(text).toContain('Starter costs & only $9/month.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('Home'); // nav stripped
    expect(text).not.toContain('color:red');
  });

  it('converts list items and decodes entities', () => {
    const { text } = htmlToText('<ul><li>&lt;First&gt;</li><li>Second&#39;s</li></ul>');
    expect(text).toContain('- <First>');
    expect(text).toContain("- Second's");
  });
});

describe('UrlFetcherService.fetchPage validation', () => {
  let service: UrlFetcherService;

  beforeEach(() => {
    service = new UrlFetcherService();
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(service.fetchPage('ftp://example.com/x')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.fetchPage('file:///etc/passwd')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects non-standard ports', async () => {
    await expect(service.fetchPage('http://example.com:8080/')).rejects.toThrow(
      /ports/i,
    );
  });

  it('rejects credentials in the URL', async () => {
    await expect(service.fetchPage('https://user:pass@example.com/')).rejects.toThrow(
      /credentials/i,
    );
  });

  it('rejects private IP literals without any DNS lookup', async () => {
    await expect(service.fetchPage('http://127.0.0.1/admin')).rejects.toThrow(
      /private/i,
    );
    await expect(
      service.fetchPage('http://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(/private/i);
  });

  it('rejects hosts that resolve to private addresses', async () => {
    // localhost resolves to 127.0.0.1/::1 on every machine — a real resolution
    // path through assertPublicHost without depending on external DNS.
    await expect(service.fetchPage('http://localhost/')).rejects.toThrow(
      /private|resolve/i,
    );
  });

  describe('with mocked fetch', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    // Bypass DNS for these — point at a public-looking host and stub fetch.
    const stubDns = (svc: UrlFetcherService) => {
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(svc as any, 'assertPublicHost')
        .mockResolvedValue(undefined);
    };

    it('refuses to follow redirects', async () => {
      stubDns(service);
      global.fetch = jest.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }),
      ) as unknown as typeof fetch;
      await expect(service.fetchPage('https://example.com/')).rejects.toThrow(
        /redirect/i,
      );
    });

    it('rejects unsupported content types', async () => {
      stubDns(service);
      global.fetch = jest.fn().mockResolvedValue(
        new Response('%PDF-1.4', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      ) as unknown as typeof fetch;
      await expect(service.fetchPage('https://example.com/doc')).rejects.toThrow(
        /content type/i,
      );
    });

    it('extracts text + title from an HTML page', async () => {
      stubDns(service);
      global.fetch = jest.fn().mockResolvedValue(
        new Response('<html><head><title>Hi</title></head><body><p>Hello</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ) as unknown as typeof fetch;
      const page = await service.fetchPage('https://example.com/');
      expect(page.title).toBe('Hi');
      expect(page.text).toContain('Hello');
    });

    it('returns plain text bodies as-is', async () => {
      stubDns(service);
      global.fetch = jest.fn().mockResolvedValue(
        new Response('raw text content', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ) as unknown as typeof fetch;
      const page = await service.fetchPage('https://example.com/readme');
      expect(page.text).toBe('raw text content');
      expect(page.title).toBeNull();
    });

    it('surfaces non-2xx statuses as a friendly error', async () => {
      stubDns(service);
      global.fetch = jest.fn().mockResolvedValue(
        new Response('nope', { status: 403 }),
      ) as unknown as typeof fetch;
      await expect(service.fetchPage('https://example.com/private')).rejects.toThrow(
        /403/,
      );
    });
  });
});
