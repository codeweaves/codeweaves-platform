import {
  markdownToWhatsapp,
  markdownToPlainText,
} from '../../../src/modules/whatsapp/whatsapp-format';

describe('markdownToWhatsapp', () => {
  it('converts **bold** and __bold__ to single-asterisk bold', () => {
    expect(markdownToWhatsapp('**hi**')).toBe('*hi*');
    expect(markdownToWhatsapp('__hi__')).toBe('*hi*');
  });

  it('converts *italic* to _italic_ and leaves _italic_ alone', () => {
    expect(markdownToWhatsapp('*hi*')).toBe('_hi_');
    expect(markdownToWhatsapp('_hi_')).toBe('_hi_');
  });

  it('handles bold and italic together', () => {
    expect(markdownToWhatsapp('**bold** and *italic*')).toBe(
      '*bold* and _italic_',
    );
  });

  it('turns Markdown headings into bold lines', () => {
    expect(markdownToWhatsapp('# Title')).toBe('*Title*');
    expect(markdownToWhatsapp('### Sub heading')).toBe('*Sub heading*');
  });

  it('flattens links and images', () => {
    expect(markdownToWhatsapp('[docs](https://x.com)')).toBe(
      'docs (https://x.com)',
    );
    expect(markdownToWhatsapp('![alt](https://img.com/a.png)')).toBe(
      'https://img.com/a.png',
    );
  });

  it('normalizes "* " / "+ " bullets to "- "', () => {
    expect(markdownToWhatsapp('* one\n+ two')).toBe('- one\n- two');
  });

  it('leaves fenced code blocks untouched (no formatting inside)', () => {
    const input = ['Before', '```', 'const x = "**bold**";', '```', 'After'].join(
      '\n',
    );
    const out = markdownToWhatsapp(input);
    expect(out).toContain('**bold**'); // not converted inside code
    expect(out).toContain('```');
    expect(out).toContain('Before');
    expect(out).toContain('After');
  });

  it('leaves inline code untouched', () => {
    expect(markdownToWhatsapp('use `**x**` here')).toBe('use `**x**` here');
  });

  it('passes plain text through unchanged (no false bold on "Plan B")', () => {
    expect(markdownToWhatsapp('hello world')).toBe('hello world');
    expect(markdownToWhatsapp('Plan B is ready')).toBe('Plan B is ready');
  });

  it('returns empty/falsy input as-is', () => {
    expect(markdownToWhatsapp('')).toBe('');
  });

  it('collapses 3+ blank lines and trims', () => {
    expect(markdownToWhatsapp('a\n\n\n\nb\n')).toBe('a\n\nb');
  });

  it('converts a realistic mixed reply', () => {
    const input =
      '## Pricing\nOur **Pro** plan is *flexible*. See [details](https://getklivo.com/pricing).';
    expect(markdownToWhatsapp(input)).toBe(
      '*Pricing*\nOur *Pro* plan is _flexible_. See details (https://getklivo.com/pricing).',
    );
  });
});

describe('markdownToPlainText (for TTS)', () => {
  it('strips emphasis + heading markers, keeping the words', () => {
    expect(markdownToPlainText('**bold** and *italic* and _und_')).toBe(
      'bold and italic and und',
    );
    expect(markdownToPlainText('# Title')).toBe('Title');
  });

  it('keeps link text, drops the URL syntax', () => {
    expect(markdownToPlainText('see [docs](https://x.com)')).toBe('see docs');
  });

  it('unwraps inline + fenced code', () => {
    expect(markdownToPlainText('use `code` now')).toBe('use code now');
  });

  it('drops bullet markers (and does not eat the "*" bullet)', () => {
    expect(markdownToPlainText('- one\n* two')).toBe('one\ntwo');
  });

  it('returns empty input as-is', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});
