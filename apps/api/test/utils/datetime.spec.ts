import {
  createTimestampFormatter,
  resolveTimeZone,
} from '../../src/utils/datetime';

describe('datetime utils', () => {
  describe('resolveTimeZone()', () => {
    it('accepts a real IANA zone', () => {
      expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
      expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
      expect(resolveTimeZone('UTC')).toBe('UTC');
    });

    it('falls back to UTC for anything unusable', () => {
      expect(resolveTimeZone(undefined)).toBe('UTC');
      expect(resolveTimeZone(null)).toBe('UTC');
      expect(resolveTimeZone('')).toBe('UTC');
      expect(resolveTimeZone('Not/AZone')).toBe('UTC');
      expect(resolveTimeZone('../../etc/passwd')).toBe('UTC');
    });
  });

  describe('createTimestampFormatter()', () => {
    const utc = createTimestampFormatter('UTC');

    it('formats as sortable YYYY-MM-DD HH:mm:ss', () => {
      expect(utc(new Date('2026-08-01T10:05:09.000Z'))).toBe(
        '2026-08-01 10:05:09',
      );
    });

    it('shifts into the target zone, including across the date boundary', () => {
      const ist = createTimestampFormatter('Asia/Kolkata'); // +05:30
      // 19:30 UTC is 01:00 the next day in IST.
      expect(ist(new Date('2026-08-01T19:30:00.000Z'))).toBe(
        '2026-08-02 01:00:00',
      );
    });

    it('applies the zone offset in force on that date (DST-aware)', () => {
      const ny = createTimestampFormatter('America/New_York');
      expect(ny(new Date('2026-01-15T17:00:00.000Z'))).toBe(
        '2026-01-15 12:00:00', // EST, -5
      );
      expect(ny(new Date('2026-07-15T17:00:00.000Z'))).toBe(
        '2026-07-15 13:00:00', // EDT, -4
      );
    });

    it('renders midnight as 00, never 24', () => {
      expect(utc(new Date('2026-08-01T00:00:00.000Z'))).toBe(
        '2026-08-01 00:00:00',
      );
    });

    it('zero-pads every component so the column stays sortable as text', () => {
      expect(utc(new Date('2026-01-02T03:04:05.000Z'))).toBe(
        '2026-01-02 03:04:05',
      );
    });
  });
});
