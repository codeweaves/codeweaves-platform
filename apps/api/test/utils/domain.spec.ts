import {
  normalizeDomain,
  isValidDomain,
  deduplicateDomains,
} from '../../src/utils/domain';

describe('Domain Utilities', () => {
  describe('normalizeDomain', () => {
    it('should strip https protocol', () => {
      expect(normalizeDomain('https://example.com')).toBe('example.com');
    });

    it('should strip http protocol', () => {
      expect(normalizeDomain('http://example.com')).toBe('example.com');
    });

    it('should strip path after domain', () => {
      expect(normalizeDomain('https://example.com/path/to/page')).toBe('example.com');
    });

    it('should strip trailing slash', () => {
      expect(normalizeDomain('example.com/')).toBe('example.com');
    });

    it('should lowercase the domain', () => {
      expect(normalizeDomain('EXAMPLE.COM')).toBe('example.com');
      expect(normalizeDomain('Example.COM')).toBe('example.com');
    });

    it('should trim whitespace', () => {
      expect(normalizeDomain('  example.com  ')).toBe('example.com');
    });

    it('should handle full URL with protocol, path, and uppercase', () => {
      expect(normalizeDomain('https://Example.COM/path')).toBe('example.com');
    });

    it('should preserve port numbers', () => {
      expect(normalizeDomain('https://example.com:8080/path')).toBe('example.com:8080');
    });

    it('should handle localhost with port', () => {
      expect(normalizeDomain('http://localhost:3000')).toBe('localhost:3000');
    });

    it('should return empty string for empty input', () => {
      expect(normalizeDomain('')).toBe('');
      expect(normalizeDomain('   ')).toBe('');
    });
  });

  describe('isValidDomain', () => {
    it('should accept simple hostnames', () => {
      expect(isValidDomain('example.com')).toBe(true);
      expect(isValidDomain('sub.example.com')).toBe(true);
      expect(isValidDomain('deep.sub.example.com')).toBe(true);
    });

    it('should accept hostnames with ports', () => {
      expect(isValidDomain('example.com:8080')).toBe(true);
      expect(isValidDomain('sub.example.com:443')).toBe(true);
    });

    it('should accept wildcard patterns', () => {
      expect(isValidDomain('*.example.com')).toBe(true);
      expect(isValidDomain('*.sub.example.com')).toBe(true);
    });

    it('should reject double wildcard patterns', () => {
      expect(isValidDomain('**.example.com')).toBe(false);
    });

    it('should reject wildcard in the middle', () => {
      expect(isValidDomain('sub.*.example.com')).toBe(false);
    });

    it('should accept localhost', () => {
      expect(isValidDomain('localhost')).toBe(true);
      expect(isValidDomain('localhost:3000')).toBe(true);
    });

    it('should accept IP addresses', () => {
      expect(isValidDomain('192.168.1.1')).toBe(true);
      expect(isValidDomain('10.0.0.1:8080')).toBe(true);
    });

    it('should accept domains with protocol (strips protocol)', () => {
      expect(isValidDomain('https://example.com')).toBe(true);
      expect(isValidDomain('http://localhost:3000')).toBe(true);
    });

    it('should reject empty strings', () => {
      expect(isValidDomain('')).toBe(false);
      expect(isValidDomain('   ')).toBe(false);
    });

    it('should reject invalid formats', () => {
      expect(isValidDomain('not a domain')).toBe(false);
      expect(isValidDomain('http://')).toBe(false);
      expect(isValidDomain('-example.com')).toBe(false);
      expect(isValidDomain('example-.com')).toBe(false);
    });
  });

  describe('deduplicateDomains', () => {
    it('should remove case-insensitive duplicates', () => {
      expect(deduplicateDomains(['a.com', 'A.COM'])).toEqual(['a.com']);
    });

    it('should remove exact duplicates', () => {
      expect(deduplicateDomains(['a.com', 'a.com', 'b.com'])).toEqual(['a.com', 'b.com']);
    });

    it('should normalize before deduplicating', () => {
      expect(
        deduplicateDomains(['https://Example.COM/path', 'example.com']),
      ).toEqual(['example.com']);
    });

    it('should preserve order of first occurrence', () => {
      expect(
        deduplicateDomains(['b.com', 'a.com', 'b.com']),
      ).toEqual(['b.com', 'a.com']);
    });

    it('should handle empty array', () => {
      expect(deduplicateDomains([])).toEqual([]);
    });

    it('should skip empty strings after normalization', () => {
      expect(deduplicateDomains(['a.com', '', '  ', 'b.com'])).toEqual([
        'a.com',
        'b.com',
      ]);
    });
  });
});
