CREATE TYPE "public"."staged_job_status" AS ENUM('PENDING', 'CONSUMED');--> statement-breakpoint
ALTER TYPE "public"."notification_channel" ADD VALUE 'EMAIL';--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"origin" text NOT NULL,
	"received" integer NOT NULL,
	"accepted" integer NOT NULL,
	"invalid" integer NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staged_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "staged_job_status" DEFAULT 'PENDING' NOT NULL,
	"consumed_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_recipients" DROP CONSTRAINT "recipients_phone_e164_chk";--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_tokens" ADD CONSTRAINT "import_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_jobs" ADD CONSTRAINT "staged_jobs_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_jobs" ADD CONSTRAINT "staged_jobs_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_jobs" ADD CONSTRAINT "staged_jobs_consumed_run_id_agent_runs_id_fk" FOREIGN KEY ("consumed_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_profile_created_idx" ON "import_batches" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_tokens_hash_uq" ON "import_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "import_tokens_user_idx" ON "import_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staged_jobs_pending_uq" ON "staged_jobs" USING btree ("profile_id","source","source_job_id") WHERE "staged_jobs"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "staged_jobs_profile_status_idx" ON "staged_jobs" USING btree ("profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_owner_email_uq" ON "notification_recipients" USING btree ("owner_user_id","channel",lower("email"));--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "recipients_address_chk" CHECK (("notification_recipients"."channel"::text = 'WHATSAPP' and "notification_recipients"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$' and "notification_recipients"."email" is null)
        or ("notification_recipients"."channel"::text = 'EMAIL' and "notification_recipients"."email" is not null and "notification_recipients"."phone_e164" is null));