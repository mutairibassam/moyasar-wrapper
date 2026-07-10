import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { CryptoError, decryptSecret, encryptSecret } from "../../src/modules/settings/crypto";

const key = randomBytes(32).toString("base64");

describe("secret crypto (AES-256-GCM)", () => {
  test("round-trips a secret", () => {
    const blob = encryptSecret("sk_test_abc123", key);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("sk_test_abc123");
    expect(decryptSecret(blob, key)).toBe("sk_test_abc123");
  });

  test("two encryptions of the same secret differ (random IV)", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  test("decryption fails (throws) with the wrong key", () => {
    const blob = encryptSecret("secret", key);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  test("a tampered ciphertext fails the auth tag", () => {
    const blob = encryptSecret("secret", key);
    const parts = blob.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("evil").toString("base64")}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  test("rejects a key that is not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(CryptoError);
  });

  test("rejects a malformed blob", () => {
    expect(() => decryptSecret("not-a-blob", key)).toThrow(CryptoError);
  });
});
