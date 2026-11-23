-- UniFi consoles now link to conex sites instead of tenants
-- (`link_level: 'site'`); old tenant links are dropped and relinked by hand.
DELETE FROM "external_links" WHERE "provider" = 'unifi' AND "entity_type" = 'tenant';
