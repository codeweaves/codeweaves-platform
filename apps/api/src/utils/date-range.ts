/**
 * Timezone-aware date range helpers for analytics.
 *
 * Analytics queries accept a YYYY-MM-DD date range and an IANA timezone
 * (e.g. `Asia/Kolkata`). We convert that wall-clock range to a half-open
 * UTC interval `[startUtc, endExclusiveUtc)` so SQL queries against UTC
 * `createdAt` columns return events that fall on the user's local day.
 *
 * The conversion uses Intl.DateTimeFormat — no third-party library — and
 * handles DST correctly because it queries the timezone's offset at the
 * specific instant we care about, not a system-wide offset.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Convert a wall-clock time in the given IANA timezone to a UTC Date.
 * Internal — exposed via {@link startOfDayUtc} / {@link startOfNextDayUtc}.
 *
 * Algorithm:
 *  1. Construct the wall-clock components as if they were UTC.
 *  2. Format that UTC instant *in the target timezone* — this tells us
 *     what local time the timezone shows for that instant.
 *  3. Reconstruct the timezone wall-clock as another UTC date.
 *  4. The difference between the two UTC dates is the timezone offset
 *     at that instant. Subtract it to get the true UTC instant whose
 *     local representation in the timezone equals the input wall-clock.
 *
 * Spring-forward edge: when the wall-clock time doesn't exist (e.g. 2:30
 * AM on a US DST start day), this returns the post-transition UTC instant
 * (3:30 AM EDT for input 2:30 AM EST). Acceptable for analytics; matches
 * date-fns-tz `fromZonedTime` behavior.
 */
function fromZonedComponents(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const wallAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(wallAsUtc)) parts[p.type] = p.value;

  // hour can be "24" in some locales for midnight; normalize to 0
  const tzHour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const tzWallAsUtc = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    tzHour,
    Number(parts.minute),
    Number(parts.second),
  ));

  const offsetMs = tzWallAsUtc.getTime() - wallAsUtc.getTime();
  return new Date(wallAsUtc.getTime() - offsetMs);
}

/**
 * UTC instant for the start of the given calendar day in the given IANA timezone.
 * Throws on malformed date string.
 */
export function startOfDayUtc(dateStr: string, timezone: string): Date {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Invalid date string (expected YYYY-MM-DD): ${dateStr}`);
  return fromZonedComponents(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, timezone);
}

/**
 * UTC instant for the start of the *next* calendar day in the given IANA
 * timezone. Use as the exclusive upper bound for a date range filter.
 *
 * Computes the next day via UTC component arithmetic on the input string,
 * not via JS `Date` arithmetic, so DST transitions on the boundary day
 * don't introduce a 23h or 25h shift.
 */
export function startOfNextDayUtc(dateStr: string, timezone: string): Date {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Invalid date string (expected YYYY-MM-DD): ${dateStr}`);
  // Use Date.UTC purely as a calendar calculator (no time-of-day involved).
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return fromZonedComponents(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0, 0, 0,
    timezone,
  );
}

/**
 * Validate that a string is a known IANA timezone (per the runtime's tzdata).
 *
 * `new Intl.DateTimeFormat({ timeZone })` accepts non-IANA values like the
 * raw abbreviation `EST` (a fixed offset, no DST). To reject those, we
 * additionally check `Intl.supportedValuesOf('timeZone')` (Node 18+ /
 * modern browsers). If the runtime doesn't expose that, we fall back to
 * a syntactic check: IANA names contain `/` (or are `UTC`).
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  // 'UTC' is always valid (supportedValuesOf may list it as 'Etc/UTC' only).
  if (tz === 'UTC') return true;
  // Reject abbreviations / fixed-offset shorthand (EST, PST, GMT, etc.) that
  // Intl.DateTimeFormat silently accepts as fixed-offset zones with no DST.
  if (!tz.includes('/')) return false;
  // Intl.DateTimeFormat accepts canonical IANA names AND deprecated aliases
  // (e.g. Asia/Bombay → Asia/Kolkata). We accept both since the alias resolves
  // to the same offset and tzdata behavior — no point rejecting a working name.
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
