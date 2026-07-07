import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.port).toBe(3001);
    expect(c.sessionTtlMinutes).toBe(720);
    expect(c.cookieSecure).toBe(true);
    expect(c.loginRateMax).toBe(5);
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
});
