ALTER TABLE "device_types" ALTER COLUMN "is_full_depth" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "device_types" ALTER COLUMN "is_full_depth" SET DATA TYPE boolean USING "is_full_depth" <> 0;--> statement-breakpoint
ALTER TABLE "device_types" ALTER COLUMN "is_full_depth" SET DEFAULT true;--> statement-breakpoint
CREATE UNIQUE INDEX "device_types_manufacturer_model_idx" ON "device_types" USING btree ("manufacturer_id","model");
