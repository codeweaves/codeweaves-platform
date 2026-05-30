import {
  startOfDayUtc,
  startOfNextDayUtc,
  isValidIanaTimezone,
} from '../../src/utils/date-range';

describe('date-range', () => {
  describe('startOfDayUtc', () => {
    it('UTC: returns start-of-day at midnight UTC', () => {
      expect(startOfDayUtc('2026-04-27', 'UTC')).toEqual(new Date('2026-04-27T00:00:00.000Z'));
    });

    it('Asia/Kolkata: returns IST midnight as UTC (5.5h before)', () => {
      // IST is UTC+5:30, no DST. IST midnight Apr 27 = UTC 18:30 Apr 26.
      expect(startOfDayUtc('2026-04-27', 'Asia/Kolkata')).toEqual(
        new Date('2026-04-26T18:30:00.000Z'),
      );
    });

    it('America/New_York standard time: midnight EST = UTC 05:00', () => {
      // Jan 15 is winter — EST (UTC-5).
      expect(startOfDayUtc('2026-01-15', 'America/New_York')).toEqual(
        new Date('2026-01-15T05:00:00.000Z'),
      );
    });

    it('America/New_York DST (EDT): midnight EDT = UTC 04:00', () => {
      // Jul 15 is summer — EDT (UTC-4).
      expect(startOfDayUtc('2026-07-15', 'America/New_York')).toEqual(
        new Date('2026-07-15T04:00:00.000Z'),
      );
    });

    it('Australia/Sydney DST: AEDT (UTC+11) midnight = UTC previous day 13:00', () => {
      // Jan is summer in Sydney → AEDT (UTC+11).
      expect(startOfDayUtc('2026-01-15', 'Australia/Sydney')).toEqual(
        new Date('2026-01-14T13:00:00.000Z'),
      );
    });

    it('Pacific/Chatham (UTC+12:45 / +13:45): handles 45-min offset', () => {
      const utc = startOfDayUtc('2026-07-15', 'Pacific/Chatham');
      // Jul is winter in Chatham → standard offset +12:45.
      // Local midnight Jul 15 = UTC Jul 14 11:15.
      expect(utc).toEqual(new Date('2026-07-14T11:15:00.000Z'));
    });

    it('throws on malformed date string', () => {
      expect(() => startOfDayUtc('2026/04/27', 'UTC')).toThrow();
      expect(() => startOfDayUtc('not-a-date', 'UTC')).toThrow();
      expect(() => startOfDayUtc('', 'UTC')).toThrow();
    });
  });

  describe('startOfNextDayUtc', () => {
    it('UTC: returns next-day midnight UTC', () => {
      expect(startOfNextDayUtc('2026-04-27', 'UTC')).toEqual(
        new Date('2026-04-28T00:00:00.000Z'),
      );
    });

    it('Asia/Kolkata: 24h after the IST start-of-day', () => {
      const start = startOfDayUtc('2026-04-27', 'Asia/Kolkata');
      const end = startOfNextDayUtc('2026-04-27', 'Asia/Kolkata');
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('rolls month boundary correctly (Jan 31 → Feb 1)', () => {
      expect(startOfNextDayUtc('2026-01-31', 'UTC')).toEqual(
        new Date('2026-02-01T00:00:00.000Z'),
      );
    });

    it('rolls year boundary correctly (Dec 31 → Jan 1 next year)', () => {
      expect(startOfNextDayUtc('2025-12-31', 'UTC')).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
    });

    it('America/New_York DST spring-forward (Mar 8 2026): produces 23h interval', () => {
      // 2026-03-08 is the US DST start (1st Sunday of March). Local day Mar 8 in
      // America/New_York is 23h long: midnight EST → next midnight EDT.
      const start = startOfDayUtc('2026-03-08', 'America/New_York');
      const end = startOfNextDayUtc('2026-03-08', 'America/New_York');
      expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
    });

    it('America/New_York DST fall-back (Nov 1 2026): produces 25h interval', () => {
      // 2026-11-01 is the US DST end (1st Sunday of November). 25h long.
      const start = startOfDayUtc('2026-11-01', 'America/New_York');
      const end = startOfNextDayUtc('2026-11-01', 'America/New_York');
      expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
    });

    it('throws on malformed date string', () => {
      expect(() => startOfNextDayUtc('bad', 'UTC')).toThrow();
    });
  });

  describe('isValidIanaTimezone', () => {
    it('accepts canonical IANA names', () => {
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
      expect(isValidIanaTimezone('Pacific/Chatham')).toBe(true);
    });

    it('rejects abbreviations and non-IANA strings', () => {
      // EST/PST/GMT are abbreviations, not IANA names. Even though
      // Intl.DateTimeFormat accepts some as fixed offsets, we want to reject.
      expect(isValidIanaTimezone('EST')).toBe(false);
      expect(isValidIanaTimezone('PST')).toBe(false);
      expect(isValidIanaTimezone('GMT')).toBe(false);
    });

    it('rejects garbage values', () => {
      expect(isValidIanaTimezone('Not/A/Real/Zone')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone(null)).toBe(false);
      expect(isValidIanaTimezone(undefined)).toBe(false);
      expect(isValidIanaTimezone(123)).toBe(false);
    });
  });
});
