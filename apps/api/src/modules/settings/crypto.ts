import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class CryptoError extends Error {}

function keyBytes(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new CryptoError("KEY_ENCRYPTION_KEY must decode to 32 bytes (AES-256)");
  }
  return key;
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = keyBytes(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(blob: string, keyB64: string): string {
  const key = keyBytes(keyB64);
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new CryptoError("Malformed secret blob");
  }
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ct = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError("Failed to decrypt secret (wrong key or corrupted data)");
  }
}
