import { describe, expect, test } from "bun:test";
import { createDb } from "@moyasar-ops/db";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createContainer } from "../src/container";
import { StateTransitionError, ValidationError } from "../src/errors";

// createDb() only opens a lazy connection (postgres-js does not connect until
// a query runs), so these tests exercise createApp's routing/error-mapping
// surface without requiring a live database.
const url =
  process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const config = {
  ...loadConfig({
    DATABASE_URL: url,
    KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  } as NodeJS.ProcessEnv),
  cookieSecure: false,
};
const container = createContainer(db, config);

describe("healthz", () => {
  test("returns ok", async () => {
    const app = createApp(container);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("error mapping", () => {
  test("AppError subclasses map to problem+json with their status", async () => {
    const app = createApp(container);
    app.get("/boom-validation", () => {
      throw new ValidationError("amount must be an integer", {
        field: "amount",
      });
    });
    app.get("/boom-state", () => {
      throw new StateTransitionError("batch is not in draft");
    });

    const v = await app.request("/boom-validation");
    expect(v.status).toBe(400);
    expect(v.headers.get("content-type")).toBe("application/problem+json");
    expect(await v.json()).toEqual({
      type: "validation_error",
      title: "amount must be an integer",
      status: 400,
      detail: { field: "amount" },
    });

    const s = await app.request("/boom-state");
    expect(s.status).toBe(409);
    expect((await s.json()).type).toBe("state_transition_error");
  });

  test("unexpected errors map to a generic 500 problem without leaking internals", async () => {
    const app = createApp(container);
    app.get("/boom-unknown", () => {
      throw new Error("secret database string");
    });
    const res = await app.request("/boom-unknown");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      type: "internal_error",
      title: "Internal Server Error",
      status: 500,
    });
  });

  test("unknown routes return problem+json 404", async () => {
    const app = createApp(container);
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).type).toBe("not_found");
  });
});
