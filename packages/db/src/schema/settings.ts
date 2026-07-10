import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { modeEnum } from "./batches";
import { users } from "./users";

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    moyasarTestKeyEnc: text("moyasar_test_key_enc"),
    moyasarLiveKeyEnc: text("moyasar_live_key_enc"),
    webhookSecretEnc: text("webhook_secret_enc"),
    activeMode: modeEnum("active_mode").notNull().default("test"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("app_settings_singleton", sql`${t.id} = 1`)],
);
