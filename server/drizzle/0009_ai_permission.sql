-- New permission `ai.use`: granted to every role that manages users, so the
-- admin role keeps holding the full catalog (`fullAccessRoleId`).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'ai.use' FROM "role_permissions" WHERE "permission" = 'users.manage'
ON CONFLICT DO NOTHING;
