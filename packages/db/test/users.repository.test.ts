import { describe, expect, test } from "bun:test";
import { createDb, createRepositories } from "../src";

const db = createDb(process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops");
const repos = createRepositories(db);
const oid = `oid-${Date.now()}`;

describe("users.upsertByEntraOid", () => {
  test("inserts with defaultRole, then updates identity but not role", async () => {
    const created = await repos.users.upsertByEntraOid({
      entraOid: oid, email: `a-${oid}@x.com`, displayName: "A", groupsSnapshot: ["g1"], defaultRole: "viewer",
    });
    expect(created.role).toBe("viewer");

    const updated = await repos.users.upsertByEntraOid({
      entraOid: oid, email: `a2-${oid}@x.com`, displayName: "A2", groupsSnapshot: ["g1", "g2"], defaultRole: "admin",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.email).toBe(`a2-${oid}@x.com`);
    expect(updated.groupsSnapshot).toEqual(["g1", "g2"]);
    expect(updated.role).toBe("viewer"); // NOT changed to admin

    const found = await repos.users.findByEntraOid(oid);
    expect(found?.id).toBe(created.id);
  });
});
