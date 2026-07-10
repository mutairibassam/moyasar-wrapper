export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  check(key: string): boolean {
    return this.prune(key).length < this.max;
  }

  hit(key: string): void {
    const kept = this.prune(key);
    kept.push(this.now());
    this.hits.set(key, kept);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
