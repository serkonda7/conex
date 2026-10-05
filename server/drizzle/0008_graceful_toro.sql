ALTER TABLE "devices" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "customer_number" text;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_id_unique" UNIQUE("device_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customer_number_unique" UNIQUE("customer_number");