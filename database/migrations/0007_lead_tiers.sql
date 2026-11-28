CREATE TYPE "public"."lead_tier" AS ENUM('HOT', 'WARM', 'COLD');--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "fit_score" integer;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "potential_score" integer;--> statement-breakpoint
ALTER TABLE "qualifications" ADD COLUMN "tier" "lead_tier";--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_fit_range_chk" CHECK ("qualifications"."fit_score" is null or ("qualifications"."fit_score" between 0 and 100));--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_potential_range_chk" CHECK ("qualifications"."potential_score" is null or ("qualifications"."potential_score" between 0 and 100));--> statement-breakpoint
-- Leads qualified before tiers existed were all alert-eligible: show them as Hot.
UPDATE "qualifications" SET "tier" = 'HOT' WHERE "decision" = 'QUALIFIED' AND "tier" IS NULL;
