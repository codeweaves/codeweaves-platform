/** Shared formatting for the organization contract card and its dialogs. */

const numberFormat = new Intl.NumberFormat("en-US");

/** 17000 -> "17,000". */
export function formatCount(value: number): string {
  return numberFormat.format(value);
}

export function pluralConversations(count: number): string {
  return count === 1 ? "conversation" : "conversations";
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

/** An ISO timestamp, shown like the rest of the organization page. */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", LONG_DATE);
}

/**
 * An ISO timestamp with local time, for example "November 14, 2026, 7:19 PM".
 * Built from two parts because the combined en-US format joins them with
 * "at" in newer ICU versions and with a comma in older ones.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date.toLocaleDateString("en-US", LONG_DATE)}, ${time}`;
}

/**
 * A calendar day ('YYYY-MM-DD') as a local Date. `new Date('2026-11-14')`
 * parses as UTC midnight, which shows the day before for anyone west of UTC,
 * so build it from the parts instead.
 */
export function parseDay(day: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * A local Date as 'YYYY-MM-DD'. Not `toISOString()`: that converts to UTC
 * first, and in IST a date picked at local midnight becomes the day before.
 */
export function toDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDay(day: string): string {
  const date = parseDay(day);
  return date ? date.toLocaleDateString("en-US", LONG_DATE) : day;
}
