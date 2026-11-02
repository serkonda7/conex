ALTER TABLE "device_type_interfaces" ADD COLUMN "maximum_draw" integer;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "poe_mode" text;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "poe_type" text;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD CONSTRAINT "device_type_interfaces_power_check" CHECK (("maximum_draw" IS NULL OR "maximum_draw" >= 1) AND ("poe_type" IS NULL OR "poe_mode" IS NOT NULL));
