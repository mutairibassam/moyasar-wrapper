import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { SettingsService } from "../../src/modules/settings/settings.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const admin: PublicUser = { id: "admin-1", email: "a@x.co", displayName: "A", role: "admin", isActive: true };
const key = randomBytes(32).toString("base64");
const ctx = { ip: "127.0.0.1" };

describe("SettingsService", () => {
  let repos: FakeRepositories;
  let service: SettingsService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new SettingsService(repos, key);
  });

  test("view masks keys and reports which are set", async () => {
    let v = await service.view();
    expect(v).toEqual({ activeMode: "test", testKeySet: false, liveKeySet: false, updatedAt: v.updatedAt });
    await service.setKey(admin, "test", "sk_test_123", ctx);
    v = await service.view();
    expect(v.testKeySet).toBe(true);
    expect(v.liveKeySet).toBe(false);
    expect(JSON.stringify(v)).not.toContain("sk_test_123");
  });

  test("setKey stores ciphertext (not plaintext) and audits settings.changed", async () => {
    await service.setKey(admin, "test", "sk_test_123", ctx);
    expect(repos.settingsRow.moyasarTestKeyEnc).not.toBeNull();
    expect(repos.settingsRow.moyasarTestKeyEnc).not.toContain("sk_test_123");
    expect(repos.auditRows.some((a) => a.action === "settings.changed")).toBe(true);
  });

  test("activeSecretKey decrypts the active mode's key; throws if unset", async () => {
    await expect(service.activeSecretKey()).rejects.toThrow(/no moyasar test api key/i);
    await service.setKey(admin, "test", "sk_test_123", ctx);
    expect(await service.activeSecretKey()).toEqual({ mode: "test", key: "sk_test_123" });
  });

  test("setMode switches the active mode and audits mode.switched", async () => {
    await service.setMode(admin, "live", ctx);
    expect(repos.settingsRow.activeMode).toBe("live");
    expect(repos.auditRows.some((a) => a.action === "mode.switched")).toBe(true);
  });
});
