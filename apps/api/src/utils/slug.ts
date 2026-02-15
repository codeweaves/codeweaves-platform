import crypto from 'crypto';

/**
 * Generate a URL-friendly slug from a name.
 *
 * @example
 * generateSlug('Acme Corp')       // 'acme-corp'
 * generateSlug('My Company 123')  // 'my-company-123'
 * generateSlug('Test & Demo!')    // 'test-demo'
 */
export function generateSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) {
    throw new Error(
      'Name must contain at least one alphanumeric character to generate a slug',
    );
  }

  return slug;
}

/**
 * Generate a unique slug by appending a random 6-character suffix.
 * Used when a base slug already exists in the database.
 *
 * @example
 * generateUniqueSlug('acme-corp') // 'acme-corp-a7f3e9'
 */
export function generateUniqueSlug(baseSlug: string): string {
  const bytes = crypto.randomBytes(4);
  const suffix = bytes.toString('hex').substring(0, 6);
  return `${baseSlug}-${suffix}`;
}
