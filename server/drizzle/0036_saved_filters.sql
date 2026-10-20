CREATE TABLE "saved_filters" (
	"table_key" text PRIMARY KEY NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
