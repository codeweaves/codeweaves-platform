import {
  markdownToPlainText,
  stripUrlsForSpeech,
  toSpeakableText,
  hasSpeakableContent,
} from '../../../src/common/text/speakable-text';

describe('markdownToPlainText', () => {
  it('keeps link text and drops the target', () => {
    expect(markdownToPlainText('[MNC PMS](https://example.com/mnc.php)')).toBe(
      'MNC PMS',
    );
  });

  it('drops emphasis, heading and list markers', () => {
    expect(markdownToPlainText('**MNC PMS**: a fund')).toBe('MNC PMS: a fund');
    expect(markdownToPlainText('## Heading')).toBe('Heading');
    expect(markdownToPlainText('- first\n- second')).toBe('first\nsecond');
  });

  it('keeps code contents without the fences', () => {
    expect(markdownToPlainText('run `bun test` now')).toBe('run bun test now');
  });
});

describe('stripUrlsForSpeech', () => {
  it('removes http/https/www URLs', () => {
    expect(stripUrlsForSpeech('go to https://example.com/a.php now').trim()).toBe(
      'go to  now'.trim(),
    );
    expect(stripUrlsForSpeech('www.example.com').trim()).toBe('');
  });

  it('removes the bracket a URL was wrapped in', () => {
    expect(stripUrlsForSpeech('MNC PMS (https://example.com/a)').trim()).toBe(
      'MNC PMS',
    );
  });

  it('leaves prose that merely contains dots alone', () => {
    expect(stripUrlsForSpeech('e.g. version 2.5.1 of the file a.pdf')).toBe(
      'e.g. version 2.5.1 of the file a.pdf',
    );
  });
});

describe('toSpeakableText — Markdown links and URLs', () => {
  // The production complaint: a PMS answer carrying four Markdown links was
  // read out character by character, "h-t-t-p-s colon slash slash ...", for
  // most of a minute.
  it('speaks the link label, never the URL', () => {
    expect(
      toSpeakableText(
        'Review our strategies: [MNC PMS](https://www.example.com/mnc-portfolio-management-service.php).',
      ),
    ).toBe('Review our strategies: MNC PMS.');
  });

  it('turns a bulleted list of links into a pause-separated sentence', () => {
    const reply = [
      '- [Impress PMS Performance](https://www.example.com/impress.php)',
      '- [MNC PMS Performance](https://www.example.com/mnc.php)',
    ].join('\n');
    expect(toSpeakableText(reply)).toBe(
      'Impress PMS Performance. MNC PMS Performance',
    );
  });

  it('drops a bare URL and the dangling punctuation it leaves behind', () => {
    expect(
      toSpeakableText('You can view performance here: https://www.example.com/a.php'),
    ).toBe('You can view performance here:');
    expect(
      toSpeakableText('See https://www.example.com/a.php for details.'),
    ).toBe('See for details.');
  });

  it('reports a URL-only sentence as nothing to speak', () => {
    const speak = toSpeakableText('https://www.example.com/a.php');
    expect(speak).toBe('');
    expect(hasSpeakableContent(speak)).toBe(false);
  });

  it('is idempotent — safe to run on already-cleaned text', () => {
    const once = toSpeakableText('**Hi** [docs](https://example.com) 😊');
    expect(toSpeakableText(once)).toBe(once);
  });

  it('does not mangle an ordinary reply', () => {
    expect(
      toSpeakableText('Sure, our minimum investment is Rs. 50 lakh. Shall I connect you?'),
    ).toBe('Sure, our minimum investment is Rs. 50 lakh. Shall I connect you?');
  });
});
