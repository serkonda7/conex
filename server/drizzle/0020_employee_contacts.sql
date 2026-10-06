ALTER TABLE "employees" ADD COLUMN "emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phones" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- The single email/phone/mobile values become the first work entries of the lists.
UPDATE "employees" SET
	"emails" = CASE WHEN "email" IS NOT NULL
		THEN jsonb_build_array(jsonb_build_object('address', "email", 'scope', 'work'))
		ELSE '[]'::jsonb END,
	"phones" = CASE WHEN "phone" IS NOT NULL
		THEN jsonb_build_array(jsonb_build_object('number', "phone", 'type', 'phone', 'scope', 'work'))
		ELSE '[]'::jsonb END
	|| CASE WHEN "mobile" IS NOT NULL
		THEN jsonb_build_array(jsonb_build_object('number', "mobile", 'type', 'mobile', 'scope', 'work'))
		ELSE '[]'::jsonb END;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "mobile";
