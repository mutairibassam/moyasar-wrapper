ALTER TABLE "users" ADD COLUMN "entra_oid" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "groups_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_entra_oid_unique" UNIQUE("entra_oid");