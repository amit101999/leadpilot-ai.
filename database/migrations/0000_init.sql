CREATE TYPE "public"."audit_actor_type" AS ENUM('USER', 'SYSTEM', 'EXECUTOR', 'WEBHOOK');--> statement-breakpoint
CREATE TYPE "public"."budget_type" AS ENUM('FIXED', 'HOURLY', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."integration_state" AS ENUM('CONNECTED', 'CONFIGURED', 'NOT_CONFIGURED', 'NOT_AUTHORIZED', 'UNAVAILABLE', 'MOCK');--> statement-breakpoint
CREATE TYPE "public"."job_processing_status" AS ENUM('NEW', 'FILTERED_OUT', 'PENDING_AI', 'QUALIFIED', 'REJECTED', 'NEEDS_REVIEW', 'AI_ERROR', 'SOURCE_ERROR');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('WHATSAPP');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('RESERVED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'UNCERTAIN', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."qualification_decision" AS ENUM('QUALIFIED', 'REJECTED', 'NEEDS_REVIEW', 'AI_ERROR');--> statement-breakpoint
CREATE TYPE "public"."run_stage" AS ENUM('SOURCE_CHECK', 'DISCOVERY', 'HARD_FILTERS', 'AI_EVALUATION', 'SELECTION', 'NOTIFICATION', 'FINALIZATION');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED', 'BLOCKED_SOURCE');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'OPERATOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "run_status" DEFAULT 'QUEUED' NOT NULL,
	"executor" text NOT NULL,
	"source_provider" text NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"external_execution_id" text,
	"source_count" integer DEFAULT 0 NOT NULL,
	"hard_filter_pass_count" integer DEFAULT 0 NOT NULL,
	"ai_evaluated_count" integer DEFAULT 0 NOT NULL,
	"qualified_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"notified_count" integer DEFAULT 0 NOT NULL,
	"failed_notification_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_summary" jsonb,
	"summary_notification" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor_type" "audit_actor_type" DEFAULT 'USER' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"status" "integration_state" NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"sanitized_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_status_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"job_url" text,
	"budget_type" "budget_type" DEFAULT 'UNKNOWN' NOT NULL,
	"budget_amount" numeric(14, 2),
	"budget_max" numeric(14, 2),
	"hourly_min" numeric(14, 2),
	"hourly_max" numeric(14, 2),
	"currency" text,
	"payment_verified" boolean,
	"client_rating" numeric(3, 2),
	"client_hires" integer,
	"client_total_spent" numeric(14, 2),
	"client_country" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"posted_at" timestamp with time zone,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "notification_status" NOT NULL,
	"http_status" integer,
	"provider_message_id" text,
	"error" text,
	"manual" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"channel" "notification_channel" DEFAULT 'WHATSAPP' NOT NULL,
	"phone_e164" text NOT NULL,
	"opt_in_confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipients_phone_e164_chk" CHECK ("notification_recipients"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'WHATSAPP' NOT NULL,
	"status" "notification_status" DEFAULT 'RESERVED' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"message_preview" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"configuration" jsonb NOT NULL,
	"change_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"score" integer,
	"model_reported_score" integer,
	"dimension_scores" jsonb,
	"decision" "qualification_decision" NOT NULL,
	"decision_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"model_identifier" text NOT NULL,
	"input_hash" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualifications_score_range_chk" CHECK ("qualifications"."score" is null or ("qualifications"."score" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "run_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"processing_status" "job_processing_status" DEFAULT 'NEW' NOT NULL,
	"hard_check_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previously_seen" boolean DEFAULT false NOT NULL,
	"passed_hard_filters" boolean DEFAULT false NOT NULL,
	"ai_attempts" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"notification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "run_stage" NOT NULL,
	"status" "stage_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"configuration" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'OPERATOR' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_profile_version_id_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."profile_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."notification_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stages" ADD CONSTRAINT "run_stages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_requester_idempotency_uq" ON "agent_runs" USING btree ("requested_by","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_profile_uq" ON "agent_runs" USING btree ("profile_id") WHERE "agent_runs"."status" in ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "runs_profile_created_idx" ON "agent_runs" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_source_job_id_uq" ON "jobs" USING btree ("source","source_job_id");--> statement-breakpoint
CREATE INDEX "jobs_first_seen_idx" ON "jobs" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "notification_attempts_notification_idx" ON "notification_attempts" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_owner_phone_uq" ON "notification_recipients" USING btree ("owner_user_id","channel","phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_job_channel_recipient_uq" ON "notifications" USING btree ("job_id","channel","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_key_uq" ON "notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_provider_message_id_uq" ON "notifications" USING btree ("provider_message_id") WHERE "notifications"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_run_status_idx" ON "notifications" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_profile_version_uq" ON "profile_versions" USING btree ("profile_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "qualifications_run_job_uq" ON "qualifications" USING btree ("run_id","job_id");--> statement-breakpoint
CREATE INDEX "qualifications_job_idx" ON "qualifications" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_jobs_run_job_uq" ON "run_jobs" USING btree ("run_id","job_id");--> statement-breakpoint
CREATE INDEX "run_jobs_run_status_idx" ON "run_jobs" USING btree ("run_id","processing_status");--> statement-breakpoint
CREATE INDEX "run_jobs_job_idx" ON "run_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_stages_run_stage_uq" ON "run_stages" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "profiles_owner_idx" ON "search_profiles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_one_default_per_owner_uq" ON "search_profiles" USING btree ("owner_user_id") WHERE "search_profiles"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));