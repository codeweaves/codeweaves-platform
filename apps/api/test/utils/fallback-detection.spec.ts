import { detectFallback } from '../../src/utils/fallback-detection';

describe('detectFallback', () => {
  const phrase = "I'm not sure about that — let me connect you with our team.";
  const phrases = [phrase];

  it('returns null (untracked) when the agent has no phrases', () => {
    expect(detectFallback('anything', [])).toEqual({ couldntAnswer: null, couldntAnswerScore: null });
    expect(detectFallback('anything', null)).toEqual({ couldntAnswer: null, couldntAnswerScore: null });
    expect(detectFallback('anything', undefined)).toEqual({ couldntAnswer: null, couldntAnswerScore: null });
  });

  it('returns null for an empty reply', () => {
    expect(detectFallback('', phrases).couldntAnswer).toBeNull();
    expect(detectFallback('   ', phrases).couldntAnswer).toBeNull();
  });

  it('flags an exact phrase match (score 1)', () => {
    const r = detectFallback(phrase, phrases);
    expect(r.couldntAnswer).toBe(true);
    expect(r.couldntAnswerScore).toBe(1);
  });

  it('flags a near-verbatim reply (minor punctuation/wording differences)', () => {
    const r = detectFallback("I'm not sure about that, let me connect you with our team", phrases);
    expect(r.couldntAnswer).toBe(true);
    expect(r.couldntAnswerScore).toBeGreaterThanOrEqual(0.7);
  });

  it('does NOT flag a long, helpful reply that merely mentions uncertainty (length pre-filter)', () => {
    const reply =
      'No idea about the exact pricing but approximately it costs $50/month, and you can check our website for the exact numbers and current promotions.';
    const r = detectFallback(reply, phrases);
    expect(r.couldntAnswer).toBe(false); // evaluated as a real answer, not a fallback
  });

  it('does NOT flag a short answer that differs from the phrases', () => {
    const r = detectFallback('Yes, it costs $50 per month.', phrases);
    expect(r.couldntAnswer).toBe(false);
  });

  it('matches against any of multiple phrases', () => {
    const multi = ['No idea, sorry.', phrase];
    expect(detectFallback('No idea, sorry.', multi).couldntAnswer).toBe(true);
  });
});
