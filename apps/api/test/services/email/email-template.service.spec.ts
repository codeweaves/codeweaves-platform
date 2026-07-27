import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  EmailTemplateService,
  htmlToText,
} from '../../../src/services/email-template.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('EmailTemplateService', () => {
  let service: EmailTemplateService;

  const mockPrisma = {
    emailTemplate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(EmailTemplateService);
  });

  const template = (overrides: Partial<{ subject: string; html: string }> = {}) => ({
    subject: 'A visitor wants a human on {{agentName}}',
    html: '<p>Hi {{orgName}}, {{agentName}} needs you.</p><a href="{{conversationUrl}}">Open</a>',
    ...overrides,
  });

  describe('render', () => {
    it('substitutes declared variables into the subject and html', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(template());

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: 'Acme Corp',
        agentName: 'Support Bot',
        conversationUrl: 'https://app.example.com/inbox?session=abc',
      });

      expect(result.subject).toBe('A visitor wants a human on Support Bot');
      expect(result.html).toContain('Hi Acme Corp, Support Bot needs you.');
      expect(result.html).toContain('href="https://app.example.com/inbox?session=abc"');
    });

    // The core injection guard: values come from outside (org names, agent
    // names), templates are authored by an admin. An org named `<script>` must
    // not become markup in every email built from that template.
    it('HTML-escapes substituted values', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(template());

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: '<script>alert(1)</script>',
        agentName: '"><img src=x onerror=alert(1)>',
        conversationUrl: 'https://example.com',
      });

      expect(result.html).not.toContain('<script>');
      expect(result.html).not.toContain('<img');
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).toContain('&quot;&gt;&lt;img');
    });

    it('cannot break out of an href attribute', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<a href="{{conversationUrl}}">Open</a>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        conversationUrl: 'https://example.com" onmouseover="alert(1)',
        orgName: 'Acme',
        agentName: 'Bot',
      });

      // The quote is escaped, so the attribute cannot be closed early.
      expect(result.html).not.toContain('onmouseover="alert(1)"');
      expect(result.html).toContain('&quot;');
    });

    it('drops non-http(s) URLs in *Url variables', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<a href="{{conversationUrl}}">Open</a>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        conversationUrl: 'javascript:alert(document.cookie)',
        orgName: 'Acme',
        agentName: 'Bot',
      });

      expect(result.html).toBe('<a href="#">Open</a>');
    });

    it('renders undeclared placeholders as empty rather than leaking the token', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<p>{{nonsense}}|{{orgName}}</p>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: 'Acme',
        agentName: 'Bot',
        conversationUrl: 'https://example.com',
      });

      expect(result.html).toBe('<p>|Acme</p>');
      expect(result.html).not.toContain('{{');
    });

    it('renders missing values as empty strings', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<p>[{{orgName}}]</p>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: undefined,
        agentName: 'Bot',
        conversationUrl: 'https://example.com',
      });

      expect(result.html).toBe('<p>[]</p>');
    });

    // A single pass matters: if the output were rescanned, a value containing a
    // placeholder could trigger a second substitution round.
    it('does not re-substitute a placeholder that came from a value', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<p>{{orgName}}</p>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: '{{agentName}}',
        agentName: 'LEAKED',
        conversationUrl: 'https://example.com',
      });

      expect(result.html).not.toContain('LEAKED');
    });

    it('does not HTML-escape the subject but strips newlines from it', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ subject: 'Alert for {{orgName}}' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: 'Smith & Sons\r\nBcc: attacker@evil.com',
        agentName: 'Bot',
        conversationUrl: 'https://example.com',
      });

      // Ampersand stays literal (a header, not HTML)…
      expect(result.subject).toContain('Smith & Sons');
      // …but CR/LF is gone, so a value can't forge extra headers.
      expect(result.subject).not.toMatch(/[\r\n]/);
    });

    it('derives a plain-text part', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ html: '<h1>Hello</h1><p>{{orgName}} needs you.</p>' }),
      );

      const result = await service.render('HANDOVER_REQUESTED', {
        orgName: 'Acme',
        agentName: 'Bot',
        conversationUrl: 'https://example.com',
      });

      expect(result.text).toContain('Hello');
      expect(result.text).toContain('Acme needs you.');
      expect(result.text).not.toContain('<');
    });

    it('throws when the template row is missing', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(null);
      await expect(service.render('HANDOVER_REQUESTED', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cache', () => {
    it('reads the row once for repeated renders', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(template());

      await service.render('HANDOVER_REQUESTED', { orgName: 'A' });
      await service.render('HANDOVER_REQUESTED', { orgName: 'B' });

      expect(mockPrisma.emailTemplate.findUnique).toHaveBeenCalledTimes(1);
    });

    // Without this the editor reads as broken — you save, and the next email
    // still uses the old copy until the TTL expires.
    it('re-reads after invalidate', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(template());

      await service.render('HANDOVER_REQUESTED', { orgName: 'A' });
      service.invalidate('HANDOVER_REQUESTED');
      await service.render('HANDOVER_REQUESTED', { orgName: 'A' });

      expect(mockPrisma.emailTemplate.findUnique).toHaveBeenCalledTimes(2);
    });

    it('updateFromEditor invalidates the cache', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(template());
      await service.render('HANDOVER_REQUESTED', { orgName: 'A' });

      mockPrisma.emailTemplate.update.mockResolvedValue({
        key: 'HANDOVER_REQUESTED',
        subject: 'New subject',
        html: '<p>new</p>',
      });
      await service.updateFromEditor(
        'HANDOVER_REQUESTED',
        { subject: 'New subject', html: '<p>new</p>' },
        'user-1',
      );

      mockPrisma.emailTemplate.findUnique.mockResolvedValue(
        template({ subject: 'New subject', html: '<p>new</p>' }),
      );
      const result = await service.render('HANDOVER_REQUESTED', {});
      expect(result.subject).toBe('New subject');
    });
  });

  describe('updateFromEditor', () => {
    it('returns the previous values alongside the updated row', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue({
        subject: 'Old',
        html: '<p>old</p>',
      });
      mockPrisma.emailTemplate.update.mockResolvedValue({
        key: 'HANDOVER_REQUESTED',
        subject: 'New',
        html: '<p>new</p>',
      });

      const { row, before } = await service.updateFromEditor(
        'HANDOVER_REQUESTED',
        { subject: 'New', html: '<p>new</p>' },
        'user-1',
      );

      expect(before.subject).toBe('Old');
      expect(row.subject).toBe('New');
      expect(mockPrisma.emailTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'HANDOVER_REQUESTED' },
          data: expect.objectContaining({ updatedBy: 'user-1' }),
        }),
      );
    });

    // update, not upsert — a key outside the seeded set must never create a row.
    it('throws instead of creating when the key does not exist', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.updateFromEditor(
          'HANDOVER_REQUESTED',
          { subject: 'x', html: 'y' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.emailTemplate.update).not.toHaveBeenCalled();
    });
  });

  describe('getForEditor', () => {
    it('returns the row with its variable descriptors', async () => {
      mockPrisma.emailTemplate.findUnique.mockResolvedValue({
        key: 'HANDOVER_REQUESTED',
        ...template(),
      });

      const result = await service.getForEditor('HANDOVER_REQUESTED');
      expect(result.variables.map((v) => v.key)).toEqual([
        'orgName',
        'agentName',
        'conversationUrl',
      ]);
    });
  });

  describe('renderPreview', () => {
    it('escapes sample values and ignores unknown keys', () => {
      const result = service.renderPreview(
        'HANDOVER_REQUESTED',
        '<p>{{orgName}}{{bogus}}</p>',
        'Hi {{orgName}}',
        { orgName: '<b>x</b>' },
      );
      expect(result.html).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
      expect(result.subject).toBe('Hi <b>x</b>');
    });

    it('passes through untouched for an unknown template key', () => {
      const result = service.renderPreview('NOPE', '<p>{{a}}</p>', 'S', {});
      expect(result.html).toBe('<p>{{a}}</p>');
    });
  });

  describe('htmlToText', () => {
    it('strips tags, scripts and styles and decodes entities', () => {
      const text = htmlToText(
        '<style>p{color:red}</style><script>alert(1)</script><h1>Hi</h1><p>A &amp; B</p><br/>C',
      );
      expect(text).not.toContain('alert');
      expect(text).not.toContain('color:red');
      expect(text).toContain('Hi');
      expect(text).toContain('A & B');
      expect(text).toContain('C');
    });
  });
});
