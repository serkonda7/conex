CREATE TABLE "saved_layouts" (
	"table_key" text PRIMARY KEY NOT NULL,
	"layouts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
