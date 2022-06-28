const maxTimeoutMs = 2147483647;

/**
 * In most browsers, the timeout is stored in a 32 bit integer (max 24.8 days).
 * We should prevent an infinite loop caused by an overflow.
 * This `Timer` class is a wrapper around `setTimeout` and can handle larger timeouts.
 */
export class Timer {
  private id?: NodeJS.Timeout;

  constructor(private callback: () => void, private ttlMs: number) {
    if (ttlMs < 0) throw new Error("TTL cannot be negative");

    this.schedule();
  }

  private schedule(): void {
    const timeoutMs = Math.min(this.ttlMs, maxTimeoutMs);
    this.ttlMs -= timeoutMs;

    this.id = setTimeout(() => {
      if (this.ttlMs <= 0) {
        this.callback();
      } else {
        this.schedule();
      }
    }, timeoutMs);
  }

  public cancel(): void {
    clearTimeout(this.id);
  }
}
