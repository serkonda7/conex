ALTER TABLE "site_groups" DROP CONSTRAINT "site_groups_parent_id_site_groups_id_fk";
--> statement-breakpoint
DROP INDEX "site_groups_parent_id_idx";--> statement-breakpoint
DROP INDEX "site_groups_sibling_slug_idx";--> statement-breakpoint
ALTER TABLE "site_groups" DROP COLUMN "parent_id";--> statement-breakpoint
ALTER TABLE "site_groups" ADD CONSTRAINT "site_groups_slug_unique" UNIQUE("slug");