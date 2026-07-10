import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password";

describe("password hashing", () => {
  test("hash is argon2id and not the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  test("verify accepts the right password and rejects wrong ones", async () => {
    const hash = await hashPassword("s3cret-passw0rd");
    expect(await verifyPassword("s3cret-passw0rd", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("two hashes of the same password differ (salted)", async () => {
    const a = await hashPassword("same-input-000");
    const b = await hashPassword("same-input-000");
    expect(a).not.toBe(b);
  });
});
