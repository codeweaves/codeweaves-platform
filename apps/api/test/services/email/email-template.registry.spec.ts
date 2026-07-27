import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  EMAIL_TEMPLATE_KEYS,
  TEMPLATE_VARIABLES,
  isEmailTemplateKey,
  templateSampleVars,
  templateVariables,
} from '../../../src/services/email-template.registry';

const MIGRATIONS_DIR = join(__dirname, '../../../prisma/migrations');

/** Every `INSERT INTO "email_templates"` key seeded across all migrations. */
function seededKeys(): Set<string> {
  const keys = new Set<string>();
  for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir.name, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    if (!sql.includes('email_templates')) continue;
    // The seed rows are `VALUES ( 'KEY', ...` — capture the first literal after
    // each INSERT into email_templates.
    for (const block of sql.split(/INSERT\s+INTO\s+"email_templates"/i).slice(1)) {
      const match = block.match(/VALUES\s*\(\s*'([A-Z0-9_]+)'/i);
      if (match?.[1]) keys.add(match[1]);
    }
  }
  return keys;
}

describe('email template registry', () => {
  /**
   * The one genuine footgun in "adding a new email is plug and play": a template
   * registered in code but never seeded by a migration only fails when something
   * actually tries to SEND it — EmailTemplateService.load throws NotFoundException
   * at runtime, in production, on a customer-facing action.
   *
   * These two tests move that failure to CI.
   */
  it('every registered template key is seeded by a migration', () => {
    const seeded = seededKeys();
    const missing = EMAIL_TEMPLATE_KEYS.filter((k) => !seeded.has(k));

    expect(missing).toEqual([]);
  });

  it('every seeded template key is registered in code', () => {
    // The reverse gap: a seeded row with no registry entry means no variables
    // are substitutable, so its {{placeholders}} would silently render empty.
    const orphans = [...seededKeys()].filter((k) => !isEmailTemplateKey(k));

    expect(orphans).toEqual([]);
  });

  it('declares at least one variable per template', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(templateVariables(key).length).toBeGreaterThan(0);
    }
  });

  it('gives every variable a label and a non-empty sample for the preview', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      for (const v of templateVariables(key)) {
        expect(v.label.trim()).not.toBe('');
        expect(v.sample.trim()).not.toBe('');
      }
    }
  });

  it('uses unique variable keys within a template', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const keys = templateVariables(key).map((v) => v.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  // sanitizeUrlValue in EmailTemplateService only guards variables whose name
  // ends in `url`. A link variable named otherwise would skip that check.
  it('names every link variable with a url suffix so URL sanitising applies', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      for (const v of templateVariables(key)) {
        if (/^https?:/i.test(v.sample)) {
          expect(v.key).toMatch(/url$/i);
        }
      }
    }
  });

  it('templateSampleVars covers exactly the declared variables', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(Object.keys(templateSampleVars(key)).sort()).toEqual(
        templateVariables(key)
          .map((v) => v.key)
          .sort(),
      );
    }
  });

  it('rejects unknown keys', () => {
    expect(isEmailTemplateKey('HANDOVER_REQUESTED')).toBe(true);
    expect(isEmailTemplateKey('NOPE')).toBe(false);
    expect(isEmailTemplateKey('')).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isEmailTemplateKey('toString')).toBe(false);
    expect(isEmailTemplateKey('constructor')).toBe(false);
  });

  it('keeps EMAIL_TEMPLATE_KEYS in sync with TEMPLATE_VARIABLES', () => {
    expect(EMAIL_TEMPLATE_KEYS.sort()).toEqual(Object.keys(TEMPLATE_VARIABLES).sort());
  });
});
