import { withRetry } from '../../lib/retry';

// Use fake timers so exponential back-off doesn't slow down the test suite
beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

// Helper: advance timers + drain the microtask queue
async function flushAll() {
  jest.runAllTimers();
  await Promise.resolve();
}

describe('withRetry', () => {
  it('resolves immediately when fn succeeds on the first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and eventually resolves when fn fails then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, 3, 10);
    // Allow the first failure + back-off delay to elapse
    await flushAll();
    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts', async () => {
    const err = new Error('always fails');
    const fn = jest.fn().mockRejectedValue(err);

    const promise = withRetry(fn, 3, 10);
    // Drain all retry delays
    await flushAll();
    await flushAll();
    await expect(promise).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxAttempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn, 2, 10);
    await flushAll();
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('works with PromiseLike (non-Promise thenable)', async () => {
    // Simulate a Supabase-style thenable
    const thenable: PromiseLike<string> = { then: (r) => Promise.resolve('thenable').then(r) };
    const fn = jest.fn().mockReturnValue(thenable);
    await expect(withRetry(fn, 1)).resolves.toBe('thenable');
  });
});
