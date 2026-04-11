/**
 * Human-readable relative timestamp, e.g. "2d ago", "3w ago", "Jan 5"
 */
export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Strip HTML tags and dangerous control characters from user-supplied text.
 * React Native has no DOM so DOMPurify is unavailable — this covers the same
 * threat surface (stored XSS via web dashboard, injection in exported data).
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')                            // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .replace(/\s+/g, ' ')                               // collapse whitespace
    .trim();
}

/**
 * Truncate a string to maxLen characters, appending "…" when cut.
 */
export function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}
