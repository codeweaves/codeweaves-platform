import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import { isSensitiveKey } from "../../common/events/redaction.util";
import { isOrgScoped } from "../../utils/tenant-filter";

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/**
 * List counts stop at this many rows. An exact COUNT(*) over a busy table costs
 * as much as the scan itself, and nobody pages past 10,000 log rows: they narrow
 * the filters. The UI shows "10,000+" when the cap is hit.
 */
export const COUNT_CAP = 10_000;

/**
 * The ops console reads every tenant's logs, so it is platform-only. The
 * permission (AuditLog:Read) is already platform-only in the catalog; this is
 * the second lock, so a future mis-grant to an org role cannot leak other
 * tenants' rows.
 */
export function assertPlatformCaller(user: CurrentUserData): void {
  if (!user || isOrgScoped(user)) {
    throw new ForbiddenException("The ops console is platform-only");
  }
}

export interface LogWindow {
  from: Date;
  to: Date;
}

/**
 * Every log query is date-bounded, so no request can scan a whole table.
 * Missing `from` falls back to `defaultMs` before `to`; a range wider than
 * `maxDays` is rejected with a message that says what to do.
 */
export function resolveWindow(
  q: { from?: string; to?: string },
  defaultMs: number,
  maxDays: number,
  now: Date = new Date(),
): LogWindow {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultMs);
  if (from > to) {
    throw new BadRequestException("from must be before to");
  }
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    throw new BadRequestException(
      `The date range can be at most ${maxDays} days. Narrow it and try again.`,
    );
  }
  return { from, to };
}

export const daysMs = (days: number) => days * DAY_MS;

/** Offset pagination with a hard ceiling on how deep a page may start. */
export function pageWindow(page: number, limit: number) {
  const skip = (page - 1) * limit;
  if (skip >= COUNT_CAP) {
    throw new BadRequestException(
      `Only the first ${COUNT_CAP.toLocaleString("en-US")} rows can be paged. Narrow the filters.`,
    );
  }
  return { skip, take: limit };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** True when `total` stopped at COUNT_CAP; the real count is higher. */
  totalCapped: boolean;
}

export function pageMeta(
  page: number,
  limit: number,
  cappedCount: number,
): PageMeta {
  const totalCapped = cappedCount > COUNT_CAP;
  const total = Math.min(cappedCount, COUNT_CAP);
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    totalCapped,
  };
}

// Query-string names that carry a credential in third-party URLs but are too
// short or generic for the body-key matcher (e.g. Google's `?key=`).
const SENSITIVE_QUERY_PARAMS = new Set([
  "key",
  "sig",
  "signature",
  "code",
  "hub.challenge",
]);

/**
 * Redact credentials from a stored URL: userinfo and sensitive query values.
 * Write-time sanitisation already covers headers and bodies, not URLs, so this
 * is the read-side guard. Relative routes stay relative.
 */
export function scrubUrl(url: string | null): string | null {
  if (!url) return url;
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  let u: URL;
  try {
    u = new URL(url, "http://relative.invalid");
  } catch {
    return url;
  }
  let changed = false;
  if (u.username || u.password) {
    u.username = "";
    u.password = "";
    changed = true;
  }
  for (const name of [...new Set(u.searchParams.keys())]) {
    if (
      isSensitiveKey(name) ||
      SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())
    ) {
      u.searchParams.set(name, "REDACTED");
      changed = true;
    }
  }
  if (!changed) return url;
  return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

export function truncate(s: string | null, max: number): string | null {
  if (s == null || s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function uniqueIds(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}
