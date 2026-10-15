ALTER TABLE "manufacturers" DROP CONSTRAINT "manufacturers_slug_unique";--> statement-breakpoint
ALTER TABLE "site_groups" DROP CONSTRAINT "site_groups_slug_unique";--> statement-breakpoint
ALTER TABLE "tenant_groups" DROP CONSTRAINT "tenant_groups_slug_unique";--> statement-breakpoint
DROP INDEX "locations_sibling_slug_idx";--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "manufacturers" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "site_groups" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "tenant_groups" DROP COLUMN "slug";