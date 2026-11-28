CREATE TYPE "public"."ai_call_status" AS ENUM('SUCCESS', 'INVALID_OUTPUT', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_ERROR');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"job_id" uuid,
	"profile_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" "ai_call_status" NOT NULL,
	"http_status" integer,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"cost_micro_usd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_calls_attempt_chk" CHECK ("ai_calls"."attempt" >= 1),
	CONSTRAINT "ai_calls_latency_chk" CHECK ("ai_calls"."latency_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_run_idx" ON "ai_calls" USING btree ("run_id");