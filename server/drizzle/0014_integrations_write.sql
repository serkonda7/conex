-- `integrations.manage` splits into `integrations.write` (use providers: syncs,
-- links, imports) and `integrations.manage` (configure them), cumulative like
-- view / edit / delete. Roles that managed integrations keep every action.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'integrations.write' FROM "role_permissions" WHERE "permission" = 'integrations.manage'
ON CONFLICT DO NOTHING;
