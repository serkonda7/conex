ALTER TABLE "floorplan_drawings" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "floorplan_drawings" ADD COLUMN "offset_x" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "floorplan_drawings" ADD COLUMN "offset_y" double precision DEFAULT 0 NOT NULL;