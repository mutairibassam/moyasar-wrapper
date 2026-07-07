import { describe, expect, test } from "bun:test";
import { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter";

describe("SlidingWindowRateLimiter", () => {
  test("allows up to max within the window then blocks", () => {
    let t = 1000;
    const rl = new SlidingWindowRateLimiter(3, 10_000, () => t);
    for (let i = 0; i < 3; i++) {
      expect(rl.check("k")).toBe(true);
      rl.hit("k");
    }
    expect(rl.check("k")).toBe(false);
  });

  test("window slides — old hits expire", () => {
    let t = 0;
    const rl = new SlidingWindowRateLimiter(2, 1000, () => t);
    rl.hit("k");
    rl.hit("k");
    expect(rl.check("k")).toBe(false);
    t = 1001;
    expect(rl.check("k")).toBe(true);
  });

  test("reset clears a key", () => {
    const rl = new SlidingWindowRateLimiter(1, 1000, () => 0);
    rl.hit("k");
    expect(rl.check("k")).toBe(false);
    rl.reset("k");
    expect(rl.check("k")).toBe(true);
  });
});
