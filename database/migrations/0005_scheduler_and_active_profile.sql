CREATE TABLE "sync_schedules" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"every_hours" integer DEFAULT 4 NOT NULL,
	"active_from" text DEFAULT '00:00' NOT NULL,
	"active_to" text DEFAULT '23:59' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_schedules_every_hours_chk" CHECK ("sync_schedules"."every_hours" in (1, 2, 3, 4, 6, 8, 12, 24)),
	CONSTRAINT "sync_schedules_clock_chk" CHECK ("sync_schedules"."active_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "sync_schedules"."active_to" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "sync_schedules" ADD CONSTRAINT "sync_schedules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_schedules" ADD CONSTRAINT "sync_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Each owner's kept profile: the non-archived default, otherwise the most recently updated non-archived one.
-- 1) Its per-profile sync settings become the owner's scheduler, so the timing stays as it is. An interval
--    that is not one of the scheduler's steps is rounded up to the next step (5 -> 6, 10 -> 12, 13+ -> 24).
INSERT INTO "sync_schedules" ("owner_user_id", "enabled", "every_hours", "active_from", "active_to", "timezone")
SELECT
	k."owner_user_id",
	CASE WHEN jsonb_typeof(k."configuration" #> '{search,upworkSync,enabled}') = 'boolean'
		THEN (k."configuration" #>> '{search,upworkSync,enabled}')::boolean ELSE true END,
	CASE
		WHEN h IS NULL THEN 4
		WHEN h <= 4 THEN greatest(h, 1)
		WHEN h <= 6 THEN 6
		WHEN h <= 8 THEN 8
		WHEN h <= 12 THEN 12
		ELSE 24
	END,
	CASE WHEN f ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN f ELSE '00:00' END,
	CASE WHEN t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN t ELSE '23:59' END,
	coalesce(nullif(k."configuration" #>> '{search,upworkSync,timezone}', ''), 'UTC')
FROM (
	SELECT DISTINCT ON ("owner_user_id") "owner_user_id", "configuration"
	FROM "search_profiles"
	WHERE "archived_at" IS NULL
	ORDER BY "owner_user_id", "is_default" DESC, "updated_at" DESC
) k,
LATERAL (
	SELECT
		CASE WHEN jsonb_typeof(k."configuration" #> '{search,upworkSync,everyHours}') = 'number'
			THEN (k."configuration" #>> '{search,upworkSync,everyHours}')::numeric::integer END AS h,
		k."configuration" #>> '{search,upworkSync,activeFrom}' AS f,
		k."configuration" #>> '{search,upworkSync,activeTo}' AS t
) v;
--> statement-breakpoint
-- 2) Only the kept profile stays active; every other profile (and every archived one) becomes inactive.
UPDATE "search_profiles" p SET "active" = (p."id" IN (
	SELECT DISTINCT ON ("owner_user_id") "id"
	FROM "search_profiles"
	WHERE "archived_at" IS NULL
	ORDER BY "owner_user_id", "is_default" DESC, "updated_at" DESC
));
--> statement-breakpoint
DROP INDEX "profiles_one_default_per_owner_uq";--> statement-breakpoint
ALTER TABLE "search_profiles" ALTER COLUMN "active" SET DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_one_active_per_owner_uq" ON "search_profiles" USING btree ("owner_user_id") WHERE "search_profiles"."active" = true;--> statement-breakpoint
ALTER TABLE "search_profiles" DROP COLUMN "is_default";
