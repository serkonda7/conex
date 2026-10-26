ALTER TABLE "shelves" ALTER COLUMN "is_full_depth" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shelves" ALTER COLUMN "is_full_depth" SET DATA TYPE boolean USING "is_full_depth" <> 0;--> statement-breakpoint
ALTER TABLE "shelves" ALTER COLUMN "is_full_depth" SET DEFAULT true;
