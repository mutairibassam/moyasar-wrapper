import { createDb, createRepositories } from "@moyasar-ops/db";
import { hashPassword } from "../modules/auth/password";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_NAME ?? "Administrator";

if (!databaseUrl || !email || !password) {
  console.error("Set DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD");
  process.exit(1);
}
if (password.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters");
  process.exit(1);
}

const db = createDb(databaseUrl);
const repos = createRepositories(db);

const existing = await repos.users.findByEmail(email);
if (existing) {
  console.log(`admin ${email} already exists (${existing.id})`);
} else {
  const user = await repos.users.create({
    email,
    passwordHash: await hashPassword(password),
    displayName,
    role: "admin",
  });
  await repos.audit.record({
    actorId: user.id,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    after: { email, role: "admin", seeded: true },
    ip: null,
  });
  console.log(`created admin ${email} (${user.id})`);
}

await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
