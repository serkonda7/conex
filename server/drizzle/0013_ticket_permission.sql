INSERT INTO "role_permissions" ("role_id", "permission")
	SELECT "id", 'tickets.create' FROM "roles" WHERE "name" = 'Admin'
	ON CONFLICT DO NOTHING;
