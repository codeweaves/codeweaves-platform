import { Test } from '@nestjs/testing';
import type { Agent } from '@prisma/client';
import { PromptTemplateService } from '../../../src/modules/ai/prompt-template.service';

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PromptTemplateService],
    }).compile();
    service = moduleRef.get(PromptTemplateService);
  });

  const mockAgent = {
    id: 'agent-uuid-123',
    name: 'Support Bot',
  } as Agent;

  describe('resolve()', () => {
    it('returns input unchanged when template is empty', () => {
      expect(service.resolve('')).toBe('');
    });

    it('returns input unchanged when template has no placeholders (fast path)', () => {
      const text = 'Hello, this prompt has no placeholders.';
      expect(service.resolve(text)).toBe(text);
    });

    it('replaces {{date}} with YYYY-MM-DD UTC', () => {
      const result = service.resolve('Today is {{date}}.');
      expect(result).toMatch(/^Today is \d{4}-\d{2}-\d{2}\.$/);
    });

    it('replaces {{time}} with HH:MM UTC', () => {
      const result = service.resolve('Now: {{time}}');
      expect(result).toMatch(/^Now: \d{2}:\d{2} UTC$/);
    });

    it('replaces {{datetime}} with full ISO string', () => {
      const result = service.resolve('Stamp: {{datetime}}');
      expect(result).toMatch(
        /^Stamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('replaces {{agent.name}} and {{agent.id}} when agent provided', () => {
      const result = service.resolve(
        'I am {{agent.name}} ({{agent.id}}).',
        { agent: mockAgent },
      );
      expect(result).toBe('I am Support Bot (agent-uuid-123).');
    });

    it('replaces {{organization.name}} when organization provided', () => {
      const result = service.resolve('Org: {{organization.name}}', {
        organization: { name: 'Acme Inc' },
      });
      expect(result).toBe('Org: Acme Inc');
    });

    it('leaves {{organization.name}} unresolved when org name is null', () => {
      const result = service.resolve('Org: {{organization.name}}', {
        organization: { name: null },
      });
      expect(result).toBe('Org: {{organization.name}}');
    });

    it('replaces {{conversation.messageCount}} (case-insensitive)', () => {
      const result = service.resolve(
        'Msg count: {{conversation.messageCount}}',
        { messageCount: 7 },
      );
      expect(result).toBe('Msg count: 7');
    });

    it('handles messageCount of 0 (falsy but valid)', () => {
      const result = service.resolve(
        '{{conversation.messageCount}} messages',
        { messageCount: 0 },
      );
      expect(result).toBe('0 messages');
    });

    it('replaces {{conversation.summary}} when provided', () => {
      const result = service.resolve('Recap: {{conversation.summary}}', {
        summary: 'User asked about pricing.',
      });
      expect(result).toBe('Recap: User asked about pricing.');
    });

    it('replaces {{language}} when provided', () => {
      const result = service.resolve('Respond in {{language}}.', {
        language: 'Hindi',
      });
      expect(result).toBe('Respond in Hindi.');
    });

    it('leaves unknown placeholders untouched', () => {
      expect(service.resolve('Hi {{unknown}} and {{also.missing}}.')).toBe(
        'Hi {{unknown}} and {{also.missing}}.',
      );
    });

    it('is case-insensitive on variable names', () => {
      const result = service.resolve(
        '{{AGENT.NAME}} vs {{Agent.Name}}',
        { agent: mockAgent },
      );
      expect(result).toBe('Support Bot vs Support Bot');
    });

    it('tolerates whitespace inside placeholders', () => {
      const result = service.resolve('{{  agent.name  }}', {
        agent: mockAgent,
      });
      expect(result).toBe('Support Bot');
    });

    it('renders repeated placeholders consistently within one call', () => {
      const result = service.resolve('{{datetime}} == {{datetime}}');
      const [a, , b] = result.split(' ');
      expect(a).toBe(b);
    });

    it('handles all placeholders in a single template', () => {
      const result = service.resolve(
        '{{agent.name}} ({{agent.id}}) for {{organization.name}}, ' +
          '{{conversation.messageCount}} msgs, lang={{language}}, ' +
          'summary={{conversation.summary}}, date={{date}}',
        {
          agent: mockAgent,
          organization: { name: 'Acme' },
          messageCount: 3,
          language: 'English',
          summary: 'short recap',
        },
      );
      expect(result).toContain('Support Bot (agent-uuid-123) for Acme');
      expect(result).toContain('3 msgs');
      expect(result).toContain('lang=English');
      expect(result).toContain('summary=short recap');
      expect(result).toMatch(/date=\d{4}-\d{2}-\d{2}$/);
    });

    it('does not expose admin-only-looking variables via resolution', () => {
      // No registry magic — anything not in the value map passes through as
      // a literal placeholder, so a malicious operator can't trick the
      // engine into surfacing internals.
      expect(service.resolve('{{process.env.SECRET}}')).toBe(
        '{{process.env.SECRET}}',
      );
    });
  });
});
