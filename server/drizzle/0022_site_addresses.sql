ALTER TABLE "sites" ADD COLUMN "physical_street" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "physical_postcode" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "physical_city" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_street" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_postcode" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "shipping_city" text;--> statement-breakpoint
-- Split free-text addresses: a trailing "<postcode> <city>" (own line or after
-- a comma) fills postcode and city, the rest is the street with line breaks
-- joined by ", ". Addresses without a postcode go into the street as a whole.
UPDATE "sites" SET
	"physical_street" = CASE WHEN m.p IS NULL
		THEN NULLIF(regexp_replace(trim("physical_address"), '\s*\n\s*', ', ', 'g'), '')
		ELSE regexp_replace(m.p[1], '\s*\n\s*', ', ', 'g') END,
	"physical_postcode" = m.p[2],
	"physical_city" = m.p[3],
	"shipping_street" = CASE WHEN m.s IS NULL
		THEN NULLIF(regexp_replace(trim("shipping_address"), '\s*\n\s*', ', ', 'g'), '')
		ELSE regexp_replace(m.s[1], '\s*\n\s*', ', ', 'g') END,
	"shipping_postcode" = m.s[2],
	"shipping_city" = m.s[3]
FROM (
	SELECT "id",
		regexp_match("physical_address", '^(.*[^\s,])?[\s,]*\m(\d{4,5})[ \t]+([^\n,]*[^\s,])\s*$') AS "p",
		regexp_match("shipping_address", '^(.*[^\s,])?[\s,]*\m(\d{4,5})[ \t]+([^\n,]*[^\s,])\s*$') AS "s"
	FROM "sites"
) AS m
WHERE m."id" = "sites"."id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "physical_address";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "shipping_address";--> statement-breakpoint
-- The fax phone type is gone.
UPDATE "employees" SET "phones" = COALESCE(
	(SELECT jsonb_agg("p") FROM jsonb_array_elements("phones") AS "p" WHERE "p"->>'type' <> 'fax'),
	'[]'::jsonb
) WHERE "phones" @> '[{"type": "fax"}]';
