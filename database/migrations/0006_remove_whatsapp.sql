-- WhatsApp alerts were removed earlier; this drops what was kept for their old records.
-- 1) Data first, so the type changes below cannot fail on old values.
DELETE FROM "notification_attempts" WHERE "notification_id" IN (SELECT "id" FROM "notifications" WHERE "channel" = 'WHATSAPP');--> statement-breakpoint
DELETE FROM "notifications" WHERE "channel" = 'WHATSAPP';--> statement-breakpoint
DELETE FROM "notification_recipients" WHERE "channel" = 'WHATSAPP';--> statement-breakpoint
-- DELIVERED and READ only ever came from WhatsApp delivery receipts; such alerts had been sent.
UPDATE "notifications" SET "status" = 'SENT' WHERE "status" IN ('DELIVERED', 'READ');--> statement-breakpoint
UPDATE "notification_attempts" SET "outcome" = 'SENT' WHERE "outcome" IN ('DELIVERED', 'READ');--> statement-breakpoint
-- Status rows of integrations that no longer exist (WhatsApp, n8n).
DELETE FROM "integration_status" WHERE "provider" IN ('whatsapp', 'n8n');--> statement-breakpoint
-- 2) Schema.
ALTER TABLE "notification_recipients" DROP CONSTRAINT "recipients_address_chk";--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "channel" SET DEFAULT 'EMAIL'::text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "channel" SET DEFAULT 'EMAIL'::text;--> statement-breakpoint
DROP TYPE "public"."notification_channel";--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL');--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "channel" SET DEFAULT 'EMAIL'::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "channel" SET DEFAULT 'EMAIL'::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "channel" SET DATA TYPE "public"."notification_channel" USING "channel"::"public"."notification_channel";--> statement-breakpoint
ALTER TABLE "notification_attempts" ALTER COLUMN "outcome" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'RESERVED'::text;--> statement-breakpoint
DROP TYPE "public"."notification_status";--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('RESERVED', 'SENDING', 'SENT', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'UNCERTAIN', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "notification_attempts" ALTER COLUMN "outcome" SET DATA TYPE "public"."notification_status" USING "outcome"::"public"."notification_status";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'RESERVED'::"public"."notification_status";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "status" SET DATA TYPE "public"."notification_status" USING "status"::"public"."notification_status";--> statement-breakpoint
DROP INDEX "recipients_owner_phone_uq";--> statement-breakpoint
ALTER TABLE "notification_recipients" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_recipients" DROP COLUMN "phone_e164";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "delivered_at";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "read_at";