ALTER TABLE "floorplan_drawing_placements" ADD COLUMN "elevation" double precision;--> statement-breakpoint
UPDATE "floorplan_drawing_placements" SET "elevation" = CASE
	WHEN "rack_id" IS NOT NULL THEN 0
	WHEN "device_id" IS NOT NULL THEN 120
	ELSE 30
END;--> statement-breakpoint
ALTER TABLE "floorplan_drawing_placements" ALTER COLUMN "elevation" SET NOT NULL;--> statement-breakpoint
-- Stored elements get the defaults of the new height fields; keys already set win, order is kept.
UPDATE "floorplan_drawings" SET
	"walls" = coalesce((
		SELECT jsonb_agg('{"height": 250}'::jsonb || e.item ORDER BY e.n)
		FROM jsonb_array_elements("walls") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb),
	"openings" = coalesce((
		SELECT jsonb_agg(
			jsonb_build_object(
				'sill', CASE WHEN e.item->>'kind' = 'window' THEN 90 ELSE 0 END,
				'height', CASE WHEN e.item->>'kind' = 'window' THEN 126 ELSE 201 END
			) || e.item
			ORDER BY e.n
		)
		FROM jsonb_array_elements("openings") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb),
	"stairs" = coalesce((
		SELECT jsonb_agg(
			jsonb_build_object('rise', least((e.item->>'steps')::numeric * 17, 275)) || e.item
			ORDER BY e.n
		)
		FROM jsonb_array_elements("stairs") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb),
	"trays" = coalesce((
		SELECT jsonb_agg('{"elevation": 230}'::jsonb || e.item ORDER BY e.n)
		FROM jsonb_array_elements("trays") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb),
	"desks" = coalesce((
		SELECT jsonb_agg('{"height": 74}'::jsonb || e.item ORDER BY e.n)
		FROM jsonb_array_elements("desks") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb),
	"desk_groups" = coalesce((
		SELECT jsonb_agg('{"height": 74}'::jsonb || e.item ORDER BY e.n)
		FROM jsonb_array_elements("desk_groups") WITH ORDINALITY AS e(item, n)
	), '[]'::jsonb);
