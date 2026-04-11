// Accept PromiseLike<T> so Supabase query builders (which are thenable but
// not strict Promise instances) pass TypeScript's type check without casts.
export async function withRetry<T>(
  fn: () => PromiseLike<T> | Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
