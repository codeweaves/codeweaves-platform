/**
 * Timestamp formatting for exports.
 *
 * Timestamps are stored in UTC, which is right for the database and wrong for a
 * spreadsheet: someone in IST reading `2026-08-11T19:30:00Z` has to do the
 * arithmetic themselves, and a row captured at 1am local looks like it happened
 * the previous day. So the browser sends its IANA zone and the export is
 * rendered in it.
 *
 * The zone arrives from a query string, so it is validated against ICU rather
 * than trusted. Anything unrecognised falls back to UTC — a wrong-but-labelled
 * timestamp beats a failed download.
 */

/** Validate a client-supplied IANA zone, falling back to UTC. */
export function resolveTimeZone(raw: string | undefined | null): string {
  if (!raw) return 'UTC';
  try {
    // Throws RangeError on an unknown or malformed identifier.
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

/**
 * Build a `YYYY-MM-DD HH:mm:ss` formatter bound to a zone.
 *
 * Returned as a closure because the formatter is the expensive part and an
 * export renders it tens of thousands of times.
 *
 * Parts are assembled by hand rather than taking the locale's own layout, so
 * the output cannot shift with an ICU or locale change. `h23` keeps midnight as
 * `00`, not `24`, and the sortable-first ordering is what every spreadsheet
 * recognises as a datetime.
 */
export function createTimestampFormatter(
  timeZone: string,
): (date: Date) => string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  return (date: Date) => {
    const parts = formatter.formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  };
}
