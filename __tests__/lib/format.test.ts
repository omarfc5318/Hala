import { relativeTime, sanitizeText, truncate } from '../../lib/format';

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe('relativeTime', () => {
  const now = Date.now();

  it('returns "just now" for < 1 min', () => {
    const ts = new Date(now - 30_000).toISOString();
    expect(relativeTime(ts)).toBe('just now');
  });

  it('returns minutes for < 1 hour', () => {
    const ts = new Date(now - 15 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe('15m ago');
  });

  it('returns hours for < 24 h', () => {
    const ts = new Date(now - 5 * 3_600_000).toISOString();
    expect(relativeTime(ts)).toBe('5h ago');
  });

  it('returns days for < 7 d', () => {
    const ts = new Date(now - 3 * 86_400_000).toISOString();
    expect(relativeTime(ts)).toBe('3d ago');
  });

  it('returns weeks for < 30 d', () => {
    const ts = new Date(now - 14 * 86_400_000).toISOString();
    expect(relativeTime(ts)).toBe('2w ago');
  });

  it('returns formatted date for >= 30 d', () => {
    const old = new Date(now - 45 * 86_400_000);
    const result = relativeTime(old.toISOString());
    // Result is a locale-formatted date like "Jan 5" — just verify it's a string
    // and no longer uses the "ago" suffix
    expect(result).not.toContain('ago');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// sanitizeText
// ---------------------------------------------------------------------------

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<b>bold</b>')).toBe('bold');
    expect(sanitizeText('<script>alert(1)</script>text')).toBe('text');
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('strips control characters', () => {
    expect(sanitizeText('hello\x00world')).toBe('hello world');
    expect(sanitizeText('a\x01b\x1Fc')).toBe('abc');
  });

  it('collapses extra whitespace', () => {
    expect(sanitizeText('  hello   world  ')).toBe('hello world');
    expect(sanitizeText('a\t\tb')).toBe('a b');
  });

  it('leaves safe text unchanged', () => {
    expect(sanitizeText('Great burger place!')).toBe('Great burger place!');
    expect(sanitizeText('سعودي عربي')).toBe('سعودي عربي');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('handles nested tags', () => {
    expect(sanitizeText('<div><p>inner</p></div>')).toBe('inner');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns original string if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 6)).toBe('hello…');
  });

  it('handles exact boundary', () => {
    // length === maxLen → no truncation
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});
