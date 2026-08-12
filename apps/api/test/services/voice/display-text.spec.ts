import { DisplayTextTracker } from '../../../src/modules/voice/utils/display-text';
import { SentenceBuffer } from '../../../src/modules/voice/utils/sentence-buffer';

describe('DisplayTextTracker', () => {
  it('restores the newline a trimmed sentence lost', () => {
    let raw = '';
    const tracker = new DisplayTextTracker(() => raw);

    raw = 'First line.\n- Second item.';
    expect(tracker.next('First line.')).toBe('First line.');
    expect(tracker.next('- Second item.')).toBe('\n- Second item.');
  });

  it('restores blank lines between paragraphs', () => {
    const raw = 'Intro here:\n\n- One.\n- Two.';
    const tracker = new DisplayTextTracker(() => raw);
    expect(tracker.next('Intro here:')).toBe('Intro here:');
    expect(tracker.next('- One.')).toBe('\n\n- One.');
    expect(tracker.next('- Two.')).toBe('\n- Two.');
  });

  it('falls back to the bare sentence when it cannot be located', () => {
    const tracker = new DisplayTextTracker(() => 'unrelated text');
    expect(tracker.next('not in there')).toBe('not in there');
  });

  // The actual regression: a streamed bullet list must reassemble byte-for-byte,
  // otherwise the client's progressive transcript renders the whole list as one
  // bullet until the reply finishes and the real text replaces it.
  it('reassembles a streamed reply identical to the original', () => {
    const reply = [
      'Yes, we offer both standard strategies and tailored solutions.',
      'Our main strategies include:',
      '',
      '- **MNC PMS:** Focuses on multinational large-cap companies.',
      '- **Impress PMS:** Multi-cap, with a balance of mid/small and large caps.',
      '- **Decennium PMS:** Long-term capital appreciation.',
      '',
      'Would you like details on any of these?',
    ].join('\n');

    const buffer = new SentenceBuffer();
    let raw = '';
    const tracker = new DisplayTextTracker(() => raw);
    let transcript = '';

    // Feed it the way an LLM does — small token slices.
    for (let i = 0; i < reply.length; i += 7) {
      const token = reply.slice(i, i + 7);
      raw += token;
      for (const sentence of buffer.addToken(token)) {
        transcript += tracker.next(sentence);
      }
    }
    const tail = buffer.flush();
    if (tail) transcript += tracker.next(tail);

    expect(transcript).toBe(reply);
    // And the property that actually matters for rendering: every list item
    // still starts its own line.
    expect(transcript.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });
});
