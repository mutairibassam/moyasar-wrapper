import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  OIDC_ISSUER_URL: "https://issuer.example/realms/dev",
  OIDC_CLIENT_ID: "app",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REDIRECT_URI: "http://localhost:8080/api/v1/auth/callback",
  APP_ACCESS_GROUP_ID: "grp-app",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.port).toBe(3001);
    expect(c.sessionTtlMinutes).toBe(720);
    expect(c.cookieSecure).toBe(true);
  });

  test("coerces overrides", () => {
    const c = loadConfig({
      ...base,
      PORT: "4000",
      SESSION_TTL_MINUTES: "60",
      COOKIE_SECURE: "false",
    } as NodeJS.ProcessEnv);
    expect(c.port).toBe(4000);
    expect(c.sessionTtlMinutes).toBe(60);
    expect(c.cookieSecure).toBe(false);
  });

  test("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow();
  });

  test("requires KEY_ENCRYPTION_KEY", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5433/db" } as NodeJS.ProcessEnv)).toThrow();
  });

  test("defaults the Moyasar base URL", () => {
    expect(loadConfig(base as NodeJS.ProcessEnv).moyasarBaseUrl).toBe("https://api.moyasar.com/v1");
  });
});

const oidcBase = {
  DATABASE_URL: "postgres://x",
  KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  OIDC_ISSUER_URL: "https://issuer.example/realms/dev",
  OIDC_CLIENT_ID: "app",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REDIRECT_URI: "http://localhost:8080/api/v1/auth/callback",
  APP_ACCESS_GROUP_ID: "grp-app",
} as unknown as NodeJS.ProcessEnv;

describe("loadConfig oidc", () => {
  test("parses oidc block with claim-name defaults", () => {
    const c = loadConfig(oidcBase);
    expect(c.oidc.issuerUrl).toBe("https://issuer.example/realms/dev");
    expect(c.oidc.identityClaim).toBe("sub");
    expect(c.oidc.groupsClaim).toBe("groups");
    expect(c.appAccessGroupId).toBe("grp-app");
    expect(c.devLogin).toBe(false);
  });
  test("devLogin true only when explicitly 'true'", () => {
    expect(loadConfig({ ...oidcBase, DEV_LOGIN: "true" }).devLogin).toBe(true);
    expect(loadConfig({ ...oidcBase, DEV_LOGIN: "1" }).devLogin).toBe(false);
  });
  test("overrides identity claim for Entra", () => {
    expect(loadConfig({ ...oidcBase, OIDC_IDENTITY_CLAIM: "oid" }).oidc.identityClaim).toBe("oid");
  });
});
