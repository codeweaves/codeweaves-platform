import {
  CSV_BOM,
  csvCell,
  csvFilenameSegment,
  csvRow,
} from '../../src/utils/csv';

describe('csv utils', () => {
  describe('csvCell()', () => {
    it('passes plain values through unquoted', () => {
      expect(csvCell('ada@example.com')).toBe('ada@example.com');
      expect(csvCell(42)).toBe('42');
      expect(csvCell(true)).toBe('true');
    });

    it('renders null and undefined as an empty cell', () => {
      expect(csvCell(null)).toBe('');
      expect(csvCell(undefined)).toBe('');
    });

    it('quotes separators and doubles embedded quotes', () => {
      expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
      expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    });

    it('defuses spreadsheet formula injection from visitor-supplied values', () => {
      // Excel/Sheets execute these on open; the quote prefix makes them text.
      expect(csvCell('=1+1')).toBe("'=1+1");
      expect(csvCell('+1234')).toBe("'+1234");
      expect(csvCell('-1+cmd|calc')).toBe("'-1+cmd|calc");
      expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
      // Leading tab/CR are stripped by Excel before parsing, so a formula can
      // hide behind them. A tab needs no CSV quoting, only the prefix.
      expect(csvCell('\t=1+1')).toBe("'\t=1+1");
      expect(csvCell('\r=1+1')).toBe('"\'\r=1+1"');
    });

    it('defuses and quotes when a formula also contains separators', () => {
      expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(
        `"'=HYPERLINK(""http://evil"",""x"")"`,
      );
    });

    it('serialises objects and arrays as JSON', () => {
      expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
      expect(csvCell(['x', 'y'])).toBe('"[""x"",""y""]"');
    });
  });

  describe('csvRow()', () => {
    it('joins cells with commas and terminates with CRLF', () => {
      expect(csvRow(['a', 'b', 1])).toBe('a,b,1\r\n');
    });

    it('keeps empty cells positional so columns never shift', () => {
      expect(csvRow(['a', null, 'c'])).toBe('a,,c\r\n');
    });
  });

  describe('csvFilenameSegment()', () => {
    it('slugs a customer-supplied name', () => {
      expect(csvFilenameSegment('Acme Support Bot')).toBe('acme-support-bot');
    });

    it('strips anything that could break out of Content-Disposition', () => {
      expect(csvFilenameSegment('Acme "Bot" / v2\r\n')).toBe('acme-bot-v2');
    });

    it('falls back when nothing usable survives', () => {
      expect(csvFilenameSegment('日本語', 'agent')).toBe('agent');
      expect(csvFilenameSegment('', 'agent')).toBe('agent');
    });

    it('bounds the length', () => {
      expect(csvFilenameSegment('a'.repeat(200)).length).toBe(60);
    });
  });

  it('exports a UTF-8 BOM so Excel does not mangle non-ASCII names', () => {
    expect(CSV_BOM).toBe('﻿');
  });
});
