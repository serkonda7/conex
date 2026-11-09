ALTER TABLE "device_type_interfaces" DROP CONSTRAINT "device_type_interfaces_prefix_kind_idx";--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "start" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD CONSTRAINT "device_type_interfaces_start_check" CHECK ("device_type_interfaces"."start" BETWEEN 0 AND 9999);