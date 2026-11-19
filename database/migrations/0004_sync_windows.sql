ALTER TABLE "sync_state" ADD COLUMN "window_end" timestamp with time zone;--> statement-breakpoint
-- Syncs that already succeeded scanned up to their sync time; failed ones scanned nothing reliable.
UPDATE "sync_state" SET "window_end" = "last_synced_at" WHERE "last_status" IN ('OK', 'PARTIAL');
