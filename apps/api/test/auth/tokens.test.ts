import { describe, expect, test } from "bun:test";
import { generateSessionToken, hashToken } from "../../src/modules/auth/tokens";

describe("session tokens", () => {
  test("generates unique, url-safe tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  test("hashToken is deterministic 64-char hex and hides the token", () => {
    const token = generateSessionToken();
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain(token);
  });
});
