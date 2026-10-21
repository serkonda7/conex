-- Rack-mounted devices take their site from the rack (racks.site_id is required).
UPDATE "devices" SET "site_id" = "racks"."site_id"
FROM "racks"
WHERE "racks"."id" = "devices"."rack_id"
AND "devices"."site_id" IS DISTINCT FROM "racks"."site_id";
