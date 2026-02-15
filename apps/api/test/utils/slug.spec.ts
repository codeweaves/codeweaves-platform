import { generateSlug, generateUniqueSlug } from '../../src/utils/slug';

describe('Slug Utility', () => {
  describe('generateSlug', () => {
    it('should convert name to lowercase slug', () => {
      expect(generateSlug('Acme Corp')).toBe('acme-corp');
      expect(generateSlug('UPPERCASE NAME')).toBe('uppercase-name');
    });

    it('should replace spaces with hyphens', () => {
      expect(generateSlug('Multiple Word Name')).toBe('multiple-word-name');
    });

    it('should collapse multiple spaces into a single hyphen', () => {
      expect(generateSlug('Many   Spaces   Here')).toBe('many-spaces-here');
    });

    it('should strip special characters', () => {
      expect(generateSlug('Test & Demo!')).toBe('test-demo');
      expect(generateSlug('Company@#$%Name')).toBe('companyname');
      expect(generateSlug('Name (with) [brackets]')).toBe('name-with-brackets');
    });

    it('should keep numbers', () => {
      expect(generateSlug('Company 123')).toBe('company-123');
      expect(generateSlug('My Company 2026')).toBe('my-company-2026');
    });

    it('should remove leading and trailing hyphens', () => {
      expect(generateSlug('---Leading')).toBe('leading');
      expect(generateSlug('Trailing---')).toBe('trailing');
      expect(generateSlug('---Both---')).toBe('both');
    });

    it('should collapse multiple hyphens into one', () => {
      expect(generateSlug('Multiple---Hyphens')).toBe('multiple-hyphens');
    });

    it('should trim whitespace', () => {
      expect(generateSlug('  Trimmed  ')).toBe('trimmed');
    });

    it('should handle empty and whitespace-only strings', () => {
      expect(generateSlug('')).toBe('');
      expect(generateSlug('   ')).toBe('');
      expect(generateSlug('---')).toBe('');
    });

    it('should generate valid slugs from real-world names', () => {
      expect(generateSlug('Acme Corporation')).toBe('acme-corporation');
      expect(generateSlug('Tech Solutions Inc.')).toBe('tech-solutions-inc');
      expect(generateSlug('Smith & Associates')).toBe('smith-associates');
      expect(generateSlug("O'Reilly Media")).toBe('oreilly-media');
    });

    it('should normalize Unicode/diacritical characters', () => {
      expect(generateSlug('Café')).toBe('cafe');
      expect(generateSlug('naïve')).toBe('naive');
      expect(generateSlug('Résumé Builder')).toBe('resume-builder');
      expect(generateSlug('São Paulo')).toBe('sao-paulo');
    });
  });

  describe('generateUniqueSlug', () => {
    it('should append a 6-character hex suffix', () => {
      const result = generateUniqueSlug('acme-corp');
      expect(result).toMatch(/^acme-corp-[0-9a-f]{6}$/);
    });

    it('should generate different suffixes on multiple calls', () => {
      const slug1 = generateUniqueSlug('test-org');
      const slug2 = generateUniqueSlug('test-org');
      expect(slug1).not.toBe(slug2);
    });

    it('should preserve the base slug', () => {
      const result = generateUniqueSlug('my-company');
      expect(result.startsWith('my-company-')).toBe(true);
    });
  });
});
