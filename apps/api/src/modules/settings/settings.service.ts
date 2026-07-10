import type { Repositories } from "@moyasar-ops/db";
import type { Mode } from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { PublicUser } from "../auth/public-user";
import { decryptSecret, encryptSecret } from "./crypto";

export type SettingsView = {
  activeMode: Mode;
  testKeySet: boolean;
  liveKeySet: boolean;
  updatedAt: string;
};

export class SettingsService {
  constructor(
    private readonly repos: Repositories,
    private readonly keyEncryptionKey: string,
  ) {}

  async view(): Promise<SettingsView> {
    const s = await this.repos.settings.get();
    return {
      activeMode: s.activeMode,
      testKeySet: s.moyasarTestKeyEnc !== null,
      liveKeySet: s.moyasarLiveKeyEnc !== null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async setKey(actor: PublicUser, mode: Mode, key: string, ctx: { ip: string | null }): Promise<void> {
    if (key.trim() === "") throw new ValidationError("API key must not be empty");
    const enc = encryptSecret(key.trim(), this.keyEncryptionKey);
    const column = mode === "test" ? "moyasarTestKeyEnc" : "moyasarLiveKeyEnc";
    await this.repos.transaction(async (r) => {
      await r.settings.update({ [column]: enc, updatedBy: actor.id });
      await r.audit.record({
        actorId: actor.id,
        action: "settings.changed",
        entityType: "settings",
        entityId: "app_settings",
        after: { keyUpdated: mode },
        ip: ctx.ip,
      });
    });
  }

  async setMode(actor: PublicUser, mode: Mode, ctx: { ip: string | null }): Promise<void> {
    await this.repos.transaction(async (r) => {
      const before = await r.settings.get();
      await r.settings.update({ activeMode: mode, updatedBy: actor.id });
      await r.audit.record({
        actorId: actor.id,
        action: "mode.switched",
        entityType: "settings",
        entityId: "app_settings",
        before: { activeMode: before.activeMode },
        after: { activeMode: mode },
        ip: ctx.ip,
      });
    });
  }

  /** Decrypts the secret key for the currently active mode. moyasar module only. */
  async activeSecretKey(): Promise<{ mode: Mode; key: string }> {
    const s = await this.repos.settings.get();
    const enc = s.activeMode === "test" ? s.moyasarTestKeyEnc : s.moyasarLiveKeyEnc;
    if (!enc) {
      throw new ValidationError(`No Moyasar ${s.activeMode} API key is configured`);
    }
    return { mode: s.activeMode, key: decryptSecret(enc, this.keyEncryptionKey) };
  }
}
