CREATE TABLE "global_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ai_claude_model" text,
	"ai_opencode_model" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
-- New permission `settings.manage`: granted to every role that manages users,
-- so the admin role keeps holding the full catalog (`fullAccessRoleId`).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'settings.manage' FROM "role_permissions" WHERE "permission" = 'users.manage'
ON CONFLICT DO NOTHING;
