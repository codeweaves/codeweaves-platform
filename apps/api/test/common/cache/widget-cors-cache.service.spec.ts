import { WidgetCorsCacheService } from '../../../src/common/cache/widget-cors-cache.service';

describe('WidgetCorsCacheService', () => {
  let cache: WidgetCorsCacheService;

  beforeEach(() => {
    cache = new WidgetCorsCacheService();
  });

  it('returns null on miss', () => {
    expect(cache.get('does-not-exist')).toBeNull();
  });

  it('round-trips a value under both publicId and id keys', () => {
    const domains = ['example.com', 'localhost:8080'];
    cache.set({ publicId: 'ZS1M719A', id: 'uuid-1' }, domains);
    expect(cache.get('ZS1M719A')).toEqual(domains);
    expect(cache.get('uuid-1')).toEqual(domains);
  });

  it('skips missing keys gracefully on set', () => {
    cache.set({ publicId: 'pub-1' }, ['a.com']);
    expect(cache.get('pub-1')).toEqual(['a.com']);
    expect(cache.get('uuid-1')).toBeNull();

    cache.set({ id: 'uuid-2' }, ['b.com']);
    expect(cache.get('uuid-2')).toEqual(['b.com']);
  });

  it('invalidate removes both keys', () => {
    cache.set({ publicId: 'pub-1', id: 'uuid-1' }, ['a.com']);
    cache.invalidate({ publicId: 'pub-1', id: 'uuid-1' });
    expect(cache.get('pub-1')).toBeNull();
    expect(cache.get('uuid-1')).toBeNull();
  });

  it('invalidate is safe to call when keys are missing or undefined', () => {
    expect(() =>
      cache.invalidate({ publicId: 'never-cached', id: 'also-never' }),
    ).not.toThrow();
    expect(() => cache.invalidate({})).not.toThrow();
  });

  it('expires entries after TTL', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    cache.set({ publicId: 'pub-1' }, ['a.com']);
    expect(cache.get('pub-1')).toEqual(['a.com']);

    // Advance past TTL
    jest.spyOn(Date, 'now').mockReturnValue(now + WidgetCorsCacheService.TTL_MS + 1);
    expect(cache.get('pub-1')).toBeNull();
  });

  it('clearAll wipes everything (test helper)', () => {
    cache.set({ publicId: 'pub-1', id: 'uuid-1' }, ['a.com']);
    cache.set({ publicId: 'pub-2' }, ['b.com']);
    cache.clearAll();
    expect(cache.get('pub-1')).toBeNull();
    expect(cache.get('uuid-1')).toBeNull();
    expect(cache.get('pub-2')).toBeNull();
  });
});
