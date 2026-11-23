ALTER TABLE "floorplan_drawings" ADD COLUMN "trays" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "floorplan_drawings" ADD COLUMN "desks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "floorplan_drawings" ADD COLUMN "rooms" jsonb DEFAULT '[]'::jsonb NOT NULL;