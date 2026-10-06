INSERT INTO "role_permissions" ("role_id", "permission")
	SELECT "id", 'contacts.directory' FROM "roles" WHERE "name" = 'Admin'
	ON CONFLICT DO NOTHING;
