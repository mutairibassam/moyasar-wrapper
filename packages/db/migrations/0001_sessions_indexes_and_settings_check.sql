CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 1);