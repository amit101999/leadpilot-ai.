CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_client_id" text NOT NULL,
	"country" text,
	"state" text,
	"timezone" text,
	"payment_verified" boolean,
	"rating" numeric(3, 2),
	"reviews_count" integer,
	"total_spent" numeric(14, 2),
	"total_hires" integer,
	"jobs_with_hires" integer,
	"active_contracts" integer,
	"hours_total" numeric(12, 2),
	"jobs_posted" integer,
	"open_jobs" integer,
	"hire_rate_percent" integer,
	"recent_reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_history" jsonb DEFAULT '{"open":[],"closed":[]}'::jsonb NOT NULL,
	"other_open_jobs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "experience_level" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "duration" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "workload" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "persons_to_hire" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "proposals_tier" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "connects_cost" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "featured" boolean;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "invites_sent" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "interviewing" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "offers_made" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hires_made" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "workflow_status" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "preferred_qualifications" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "details_fetched_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_source_client_uq" ON "clients" USING btree ("source","source_client_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_client_idx" ON "jobs" USING btree ("client_id");--> statement-breakpoint
-- Backfill: jobs imported before this migration kept their extra posting data in source_metadata.
-- Copy it into the new columns (client rows cannot be backfilled: older imports have no client id).
-- Numbers are copied only when they are plain JSON numbers, so an unexpected value stays NULL.
UPDATE "jobs" SET
	"experience_level" = initcap(nullif("source_metadata"->>'experienceLevel', '')),
	"duration" = nullif("source_metadata"->>'duration', ''),
	"proposals_tier" = nullif("source_metadata"->>'proposalsTier', ''),
	"persons_to_hire" = CASE WHEN jsonb_typeof("source_metadata"->'freelancersToHire') = 'number' THEN ("source_metadata"->>'freelancersToHire')::numeric::integer END,
	"connects_cost" = CASE WHEN jsonb_typeof("source_metadata"#>'{job,connectsCost}') = 'number' THEN ("source_metadata"#>>'{job,connectsCost}')::numeric::integer END,
	"invites_sent" = CASE WHEN jsonb_typeof("source_metadata"#>'{job,invitesSent}') = 'number' THEN ("source_metadata"#>>'{job,invitesSent}')::numeric::integer END,
	"hires_made" = CASE WHEN jsonb_typeof("source_metadata"#>'{job,totalHired}') = 'number' THEN ("source_metadata"#>>'{job,totalHired}')::numeric::integer END,
	"workflow_status" = nullif("source_metadata"#>>'{job,workflowStatus}', ''),
	"preferred_qualifications" = CASE WHEN jsonb_typeof("source_metadata"->'preferredQualifications') = 'object' THEN "source_metadata"->'preferredQualifications' END,
	"details_fetched_at" = CASE WHEN ("source_metadata"->>'detailsFetched') = 'true' THEN "last_seen_at" END
WHERE "source_metadata"->>'origin' = 'upwork-mcp';
