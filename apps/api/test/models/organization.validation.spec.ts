import {
  createOrganizationSchema,
  updateOrganizationSchema,
  slugSchema,
} from '../../src/models/organization.dto';

describe('Organization Validation Schemas', () => {
  describe('slugSchema', () => {
    it('should accept valid slugs', () => {
      expect(slugSchema.parse('acme-corp')).toBe('acme-corp');
      expect(slugSchema.parse('my-company-123')).toBe('my-company-123');
      expect(slugSchema.parse('ab')).toBe('ab');
      expect(slugSchema.parse('123')).toBe('123');
    });

    it('should reject uppercase letters', () => {
      expect(() => slugSchema.parse('Acme-Corp')).toThrow();
      expect(() => slugSchema.parse('UPPERCASE')).toThrow();
    });

    it('should reject special characters', () => {
      expect(() => slugSchema.parse('acme corp')).toThrow();
      expect(() => slugSchema.parse('acme_corp')).toThrow();
      expect(() => slugSchema.parse('acme@corp')).toThrow();
      expect(() => slugSchema.parse('acme.corp')).toThrow();
    });

    it('should reject hyphen-only slugs', () => {
      expect(() => slugSchema.parse('--')).toThrow();
      expect(() => slugSchema.parse('---')).toThrow();
    });

    it('should reject slugs with leading or trailing hyphens', () => {
      expect(() => slugSchema.parse('-acme')).toThrow();
      expect(() => slugSchema.parse('acme-')).toThrow();
      expect(() => slugSchema.parse('-acme-')).toThrow();
    });

    it('should reject slugs that are too short', () => {
      expect(() => slugSchema.parse('a')).toThrow();
      expect(() => slugSchema.parse('')).toThrow();
    });

    it('should reject slugs that are too long', () => {
      expect(() => slugSchema.parse('a'.repeat(101))).toThrow();
    });

    it('should accept slugs at max length', () => {
      expect(slugSchema.parse('a'.repeat(100))).toBe('a'.repeat(100));
    });
  });

  describe('createOrganizationSchema', () => {
    it('should accept valid data with name and slug', () => {
      const data = { name: 'Acme Corporation', slug: 'acme-corp' };
      expect(createOrganizationSchema.parse(data)).toEqual(data);
    });

    it('should accept name without slug (slug is optional)', () => {
      const data = { name: 'Acme Corporation' };
      const result = createOrganizationSchema.parse(data);
      expect(result.name).toBe('Acme Corporation');
      expect(result.slug).toBeUndefined();
    });

    it('should reject name that is too short', () => {
      expect(() => createOrganizationSchema.parse({ name: 'A' })).toThrow();
    });

    it('should reject name that is too long', () => {
      expect(() =>
        createOrganizationSchema.parse({ name: 'A'.repeat(101) }),
      ).toThrow();
    });

    it('should reject missing name', () => {
      expect(() => createOrganizationSchema.parse({})).toThrow();
      expect(() =>
        createOrganizationSchema.parse({ slug: 'valid-slug' }),
      ).toThrow();
    });

    it('should reject invalid slug format', () => {
      expect(() =>
        createOrganizationSchema.parse({
          name: 'Valid Name',
          slug: 'Invalid Slug',
        }),
      ).toThrow();
    });
  });

  describe('updateOrganizationSchema', () => {
    it('should accept partial update with name only', () => {
      const result = updateOrganizationSchema.parse({ name: 'New Name' });
      expect(result).toEqual({ name: 'New Name' });
    });

    it('should accept partial update with slug only', () => {
      const result = updateOrganizationSchema.parse({ slug: 'new-slug' });
      expect(result).toEqual({ slug: 'new-slug' });
    });

    it('should accept both name and slug', () => {
      const data = { name: 'Updated Name', slug: 'updated-slug' };
      expect(updateOrganizationSchema.parse(data)).toEqual(data);
    });

    it('should reject empty object (no updates)', () => {
      expect(() => updateOrganizationSchema.parse({})).toThrow();
    });

    it('should reject invalid name length', () => {
      expect(() =>
        updateOrganizationSchema.parse({ name: 'A' }),
      ).toThrow();
      expect(() =>
        updateOrganizationSchema.parse({ name: 'A'.repeat(101) }),
      ).toThrow();
    });

    it('should reject invalid slug format', () => {
      expect(() =>
        updateOrganizationSchema.parse({ slug: 'Invalid Slug' }),
      ).toThrow();
    });
  });
});
