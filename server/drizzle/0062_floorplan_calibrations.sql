CREATE TABLE "floorplan_calibrations" (
	"attachment_id" integer PRIMARY KEY NOT NULL,
	"scale" jsonb,
	"origin" jsonb
);
--> statement-breakpoint
ALTER TABLE "floorplan_calibrations" ADD CONSTRAINT "floorplan_calibrations_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;