import { PiiDetectionService } from '../../../src/modules/pii/pii-detection.service';
import {
  detectPii,
  luhnValid,
  normalizeDigits,
  verhoeffValid,
} from '../../../src/modules/pii/pii-patterns';

// Verhoeff-valid 12-digit test numbers (checksum computed, not real Aadhaars).
const VALID_AADHAAR = '234123412346';
// A Luhn-valid Visa test number.
const VALID_CARD = '4111111111111111';

describe('pii-patterns checksums', () => {
  it('validates Luhn correctly', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('validates Verhoeff correctly', () => {
    expect(verhoeffValid(VALID_AADHAAR)).toBe(true);
    expect(verhoeffValid('234123412345')).toBe(false);
  });

  it('normalizes Devanagari digits with offsets preserved', () => {
    const original = 'मेरा नंबर ९८७६५ है';
    const normalized = normalizeDigits(original);
    expect(normalized).toBe('मेरा नंबर 98765 है');
    expect(normalized.length).toBe(original.length);
  });
});

describe('detectPii', () => {
  it('detects emails and phones as ALLOW tier', () => {
    const matches = detectPii('reach me at ramesh@example.com or +91 98765 43210');
    const categories = matches.map((m) => `${m.category}:${m.tier}`);
    expect(categories).toContain('EMAIL:ALLOW');
    expect(categories).toContain('PHONE:ALLOW');
  });

  it('detects a Verhoeff-valid Aadhaar without context', () => {
    const matches = detectPii(`my number is ${VALID_AADHAAR}`);
    expect(matches.some((m) => m.category === 'AADHAAR')).toBe(true);
  });

  it('detects grouped Aadhaar (4-4-4) in Hindi text with Devanagari digits', () => {
    const grouped = `${VALID_AADHAAR.slice(0, 4)}-${VALID_AADHAAR.slice(4, 8)}-${VALID_AADHAAR.slice(8)}`;
    const devanagari = grouped.replace(/\d/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x30 + 0x0966),
    );
    const matches = detectPii(`मेरा आधार ${devanagari} है`);
    expect(matches.some((m) => m.category === 'AADHAAR')).toBe(true);
  });

  it('ignores a random 12-digit number that fails Verhoeff and has no context', () => {
    const matches = detectPii('order id 123456789012 confirmed');
    expect(matches.some((m) => m.category === 'AADHAAR')).toBe(false);
  });

  it('detects PAN format', () => {
    const matches = detectPii('PAN is ABCDE1234F please');
    expect(matches.some((m) => m.category === 'PAN')).toBe(true);
  });

  it('detects Luhn-valid cards only', () => {
    expect(detectPii(`card ${VALID_CARD}`).some((m) => m.category === 'CARD')).toBe(true);
    expect(detectPii('code 4111111111111112').some((m) => m.category === 'CARD')).toBe(false);
  });

  it('gates passport on context words', () => {
    expect(detectPii('my passport number is Z1234567').some((m) => m.category === 'PASSPORT')).toBe(true);
    expect(detectPii('promo code Z1234567 applied').some((m) => m.category === 'PASSPORT')).toBe(false);
  });

  it('gates bank account on context words', () => {
    expect(
      detectPii('please debit account 123456789012345').some((m) => m.category === 'BANK_ACCOUNT'),
    ).toBe(true);
    expect(
      detectPii('tracking 123456789012345 shipped').some((m) => m.category === 'BANK_ACCOUNT'),
    ).toBe(false);
  });

  it('gates DOB on context words', () => {
    expect(detectPii('my dob is 12/08/1994').some((m) => m.category === 'DOB')).toBe(true);
    expect(detectPii('delivery on 12/08/2026 confirmed').some((m) => m.category === 'DOB')).toBe(false);
  });

  it('detects IFSC as TOKENIZE tier', () => {
    const matches = detectPii('IFSC HDFC0001234');
    const ifsc = matches.find((m) => m.category === 'IFSC');
    expect(ifsc?.tier).toBe('TOKENIZE');
  });

  it('does not match a card inside a longer digit run', () => {
    const matches = detectPii(`ref ${VALID_CARD}9999`);
    expect(matches.some((m) => m.category === 'CARD')).toBe(false);
  });
});

describe('PiiDetectionService.maskHardDrop', () => {
  const service = new PiiDetectionService();

  it('destroys Aadhaar, PAN and cards but keeps emails/phones', () => {
    const input = `aadhaar ${VALID_AADHAAR}, pan ABCDE1234F, card ${VALID_CARD}, email a@b.com, phone 9876543210`;
    const out = service.maskHardDrop(input);
    expect(out).toContain('[AADHAAR REDACTED]');
    expect(out).toContain('[PAN REDACTED]');
    expect(out).toContain('[CARD REDACTED ****1111]');
    expect(out).toContain('a@b.com');
    expect(out).toContain('9876543210');
    expect(out).not.toContain(VALID_AADHAAR);
    expect(out).not.toContain(VALID_CARD);
    expect(out).not.toContain('ABCDE1234F');
  });

  it('returns the same reference when nothing matches', () => {
    const input = 'hello, I need help with pricing';
    expect(service.maskHardDrop(input)).toBe(input);
  });

  it('handles empty and null-ish input', () => {
    expect(service.maskHardDrop('')).toBe('');
  });

  it('does not tokenize TOKENIZE-tier values (that is the tokenizer, not the floor)', () => {
    const input = 'my dob is 12/08/1994';
    expect(service.maskHardDrop(input)).toBe(input);
  });
});
