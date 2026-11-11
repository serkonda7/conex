CREATE TABLE "m365_tenants" (
	"ms_tenant_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"default_domain" text,
	"consented_at" bigint NOT NULL,
	"last_ok_at" bigint,
	"last_error" text
);
