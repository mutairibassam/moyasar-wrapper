CREATE TYPE "public"."user_role" AS ENUM('admin', 'maker', 'approver', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."batch_source" AS ENUM('csv', 'manual');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('draft', 'pending_approval', 'rejected', 'approved', 'submitting', 'submitted', 'partially_failed');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('draft', 'valid', 'invalid', 'submitting', 'submitted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."moyasar_invoice_status" AS ENUM('initiated', 'paid', 'failed', 'refunded', 'canceled', 'on_hold', 'expired', 'voided');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('submit_batch', 'sync_invoices');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invoice_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "batch_status" DEFAULT 'draft' NOT NULL,
	"source" "batch_source" NOT NULL,
	"mode" "mode",
	"currency" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"rejection_comment" text,
	"submitted_for_approval_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"item_count" integer DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"expired_at" text,
	"callback_url" text,
	"success_url" text,
	"back_url" text,
	"metadata" jsonb,
	"validation_errors" jsonb,
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"moyasar_invoice_id" text,
	"moyasar_status" "moyasar_invoice_status",
	"moyasar_url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"moyasar_test_key_enc" text,
	"moyasar_live_key_enc" text,
	"webhook_secret_enc" text,
	"active_mode" "mode" DEFAULT 'test' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"moyasar_payment_id" text,
	"moyasar_invoice_id" text,
	"payload" jsonb NOT NULL,
	"status" "webhook_event_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_batch_id_invoice_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."invoice_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batches_status" ON "invoice_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_batches_created_by" ON "invoice_batches" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_items_batch" ON "invoice_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_items_moyasar_id" ON "invoice_items" USING btree ("moyasar_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_items_status" ON "invoice_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_payment" ON "webhook_events" USING btree ("moyasar_payment_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_claim" ON "jobs" USING btree ("status","run_at");